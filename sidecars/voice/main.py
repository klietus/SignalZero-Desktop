import os
import sys
import json
import time
import threading
import queue
import numpy as np
import sounddevice as sd
import webrtcvad
import logging
import base64
import difflib
from audio_engine import AudioEngine

# Setup logging to stderr
logging.basicConfig(level=logging.INFO, stream=sys.stderr, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("voice_sidecar")

SAMPLE_RATE = 16000
CHUNK_DURATION_MS = 30
CHUNK_SIZE = int(SAMPLE_RATE * CHUNK_DURATION_MS / 1000)
VAD_MODE = 2
SILENCE_THRESHOLD_MS = 2000
SILENCE_CHUNKS = int(SILENCE_THRESHOLD_MS / CHUNK_DURATION_MS)
RMS_THRESHOLD = 0.005 

class NoiseFloorTracker:
    def __init__(self, alpha_up=0.01, alpha_down=0.001):
        self.noise_floor = None
        self.alpha_up = alpha_up
        self.alpha_down = alpha_down

    def update(self, frame_energy):
        if self.noise_floor is None:
            self.noise_floor = frame_energy
            return self.noise_floor
        # Track the floor (lower energy states)
        if frame_energy > self.noise_floor:
            self.noise_floor += self.alpha_up * (frame_energy - self.noise_floor)
        else:
            self.noise_floor += self.alpha_down * (frame_energy - self.noise_floor)
        return self.noise_floor

class VoiceSidecar:
    def __init__(self):
        self.engine = None
        self.vad = webrtcvad.Vad(1) # Mode 1: less aggressive filtering (we'll use SNR for gating)
        self.noise_tracker = NoiseFloorTracker()
        self.mic_enabled = False
        self.mic_suppressed = False
        self.enroll_mode = False
        self.current_enroll_phrase = None
        self.is_running = True
        self.tts_queue = queue.Queue()
        self.processing_queue = queue.Queue()
        self.interrupt_tts = False
        self.is_speaking_ai = False
        self.device_index = None
        self.triggered = False
        self.speech_frames = []
        self.silence_counter = 0
        self.callback_count = 0
        self.early_id_sent_count = 0
        self.early_id_threshold = 20 # ~600ms (20 * 30ms)
        self.early_id_interval = 25  # Re-check every ~750ms if long segment
        self.verified_interrupt = False # Track if current segment has a verified human

    def send_to_electron(self, msg_type, data):
        """Send JSON message to Electron via stdout"""
        try:
            print(json.dumps({"type": msg_type, "payload": data}), flush=True)
        except Exception as e:
            logger.error(f"Failed to send IPC: {e}")

    def find_input_device(self):
        try:
            devices = sd.query_devices()
            default_input = sd.default.device[0]
            if default_input >= 0:
                return default_input
            for i, dev in enumerate(devices):
                if dev['max_input_channels'] > 0:
                    return i
        except Exception as e:
            logger.error(f"Error searching for devices: {e}")
        return None

    def initialize_engine(self):
        try:
            logger.info("Initializing Python Audio Engine (Loading models)...")
            self.engine = AudioEngine() 
            self.device_index = self.find_input_device()
            if self.device_index is None:
                self.send_to_electron("error", {"message": "No microphone found"})
            else:
                self.send_to_electron("ready", {"status": "initialized", "device": self.device_index})
                logger.info(f"Engine Ready. Using device {self.device_index}")
        except Exception as e:
            logger.error(f"Failed to initialize engine: {e}")
            self.send_to_electron("error", {"message": str(e)})

    def normalize_text(self, text):
        return "".join(c.lower() for c in text if c.isalnum())

    def verify_phrase(self, recognized, expected):
        if not expected: return True
        ratio = difflib.SequenceMatcher(None, self.normalize_text(recognized), self.normalize_text(expected)).ratio()
        return ratio > 0.6 

    def audio_callback(self, indata, frames, time_info, status):
        self.callback_count += 1
        if status:
            logger.warning(f"Stream status: {status}")
        
        audio_frame = indata.flatten()
        rms = np.sqrt(np.mean(audio_frame**2))

        # 1. Update Noise Floor
        current_noise_floor = self.noise_tracker.update(rms)
        # Calculate signal-to-noise ratio in dB (with epsilons for stability)
        snr = 20 * np.log10((rms + 1e-6) / (current_noise_floor + 1e-6))
        
        # Periodic metrics for UI
        if self.callback_count % 10 == 0:
            self.send_to_electron("audio_metrics", {
                "rms": float(rms), 
                "is_speaking": self.triggered,
                "noise_floor": float(current_noise_floor),
                "snr": float(snr)
            })

        if not self.mic_enabled:
            if self.triggered:
                self.triggered = False
                self.speech_frames = []
            return

        pcm_frame = (audio_frame * 32768).astype(np.int16).tobytes()
        
        # 2. VAD Logic (Gated by SNR and Noise Floor)
        is_speech = False
        # We need a minimum SNR to consider it speech, otherwise it's just louder background noise
        if snr > 5.0: 
            try:
                is_speech = self.vad.is_speech(pcm_frame, SAMPLE_RATE)
            except:
                pass
        
        if is_speech:
            if not self.triggered:
                self.send_to_electron("speech_start", {})
                self.triggered = True
                self.early_id_sent_count = 0
                self.verified_interrupt = False # Reset human detection for new segment
            self.silence_counter = 0
            self.speech_frames.append(audio_frame)

            # Queue early speaker ID check
            # We check periodically during long segments to catch user starting to talk
            # if the AI voice already triggered the mic.
            current_frame_count = len(self.speech_frames)
            should_check_id = False
            
            if current_frame_count == self.early_id_threshold:
                should_check_id = True
            elif current_frame_count > self.early_id_threshold and (current_frame_count - self.early_id_threshold) % self.early_id_interval == 0:
                should_check_id = True
                
            if self.engine and should_check_id:
                # Use the last N frames for a snapshot
                snapshot_frames = self.speech_frames[-self.early_id_threshold:]
                audio_segment = np.concatenate(snapshot_frames)
                self.processing_queue.put({"type": "early_id", "audio": audio_segment})
                self.early_id_sent_count += 1
                if self.is_speaking_ai:
                    logger.info(f"AI is speaking. Queueing periodic speaker ID check (Snapshot {self.early_id_sent_count})")
        elif self.triggered:
            self.speech_frames.append(audio_frame)
            self.silence_counter += 1
            if self.silence_counter > SILENCE_CHUNKS:
                self.triggered = False
                self.silence_counter = 0
                
                audio_np = np.concatenate(self.speech_frames)
                self.speech_frames = []

                # ECHOCANCELLATION GATE:
                # If the mic is still suppressed (AI is speaking) and we never verified 
                # a human speaker in this segment, throw it away.
                if self.mic_suppressed and not self.verified_interrupt:
                    logger.info("Discarding segment: Mic is suppressed and no verified human speaker detected (likely AI echo).")
                    return

                if len(audio_np) >= SAMPLE_RATE * 0.7:
                    if self.enroll_mode:
                        self.processing_queue.put({"type": "enroll", "audio": audio_np})
                    elif self.engine:
                        self.processing_queue.put({"type": "stt", "audio": audio_np})

    def calculate_lr(self, score):
        """Tiered learning rate based on confidence."""
        if score >= 0.70:
            return 0.15 # Fast adaptation for very clear samples
        if score >= 0.58:
            return 0.05 # Cautious adaptation for typical matches
        return None

    def processing_worker(self):
        logger.info("Processing worker thread started")
        while self.is_running:
            try:
                task = self.processing_queue.get(timeout=1)
                if not self.engine:
                    continue
                    
                task_type = task.get("type")
                audio_np = task.get("audio")

                if task_type == "early_id":
                    speaker_name, score = self.engine.identify_speaker(audio_np)
                    if speaker_name and speaker_name != "Unknown_Speaker":
                        self.verified_interrupt = True # Human detected, allow segment collection
                        self.send_to_electron("speaker_interrupt", {"speaker": speaker_name, "score": score})
                        # Continual Training: Use tiered LR
                        lr = self.calculate_lr(score)
                        if lr:
                            updated_profile = self.engine.refine_speaker_profile(speaker_name, audio_np, custom_lr=lr)
                            if updated_profile:
                                self.send_to_electron("profile_updated", {"name": speaker_name, "profile": updated_profile})
                
                elif task_type == "enroll":
                    transcription = self.engine.transcribe(audio_np)
                    if self.verify_phrase(transcription, self.current_enroll_phrase):
                        success = self.engine.enroll_chunk(audio_np)
                        if success:
                            self.send_to_electron("enroll_progress", {
                                "count": len(self.engine.enrollment_embeddings),
                                "verified": True,
                                "text": transcription
                            })
                    else:
                        self.send_to_electron("enroll_progress", {
                            "count": len(self.engine.enrollment_embeddings),
                            "verified": False,
                            "text": transcription
                        })

                elif task_type == "stt":
                    result = self.engine.process_segment(audio_np)
                    if result and result.get('text'):
                        text = result.get('raw_text', '').lower().strip()
                        
                        # WHISPER HALLUCINATION FILTER
                        hallucinations = ["thank you", "thank you.", "watching", "you", "thanks for watching", "thank you very much", "thank you very much."]
                        duration = len(audio_np) / SAMPLE_RATE
                        
                        is_hallucination = False
                        if text in hallucinations:
                            is_hallucination = True
                        elif duration < 1.2 and any(h in text for h in ["thank you", "watching"]):
                            is_hallucination = True
                            
                        if is_hallucination:
                            logger.info(f"Filtered suspected hallucination: '{text}' ({duration:.2f}s)")
                        else:
                            # Finalized Result
                            self.send_to_electron("stt_result", result)
                            
                            # Continual Training on full segment
                            score = result.get('score', 0)
                            lr = self.calculate_lr(score)
                            if result.get('speaker') and result.get('speaker') != 'Unknown' and lr:
                                updated_profile = self.engine.refine_speaker_profile(result['speaker'], audio_np, custom_lr=lr)
                                if updated_profile:
                                    self.send_to_electron("profile_updated", {"name": result['speaker'], "profile": updated_profile})
            except queue.Empty:
                continue
            except Exception as e:
                logger.error(f"Processing worker error: {e}")

    def audio_loop(self):
        logger.info("Audio loop thread started")
        while self.is_running:
            if not self.mic_enabled:
                time.sleep(0.5)
                continue
                
            self.device_index = self.find_input_device()
            if self.device_index is None:
                logger.error("No input device found, retrying...")
                time.sleep(2)
                continue
                
            try:
                logger.info(f"Opening microphone stream on device {self.device_index}...")
                with sd.InputStream(samplerate=SAMPLE_RATE, device=self.device_index, channels=1, callback=self.audio_callback, blocksize=CHUNK_SIZE):
                    while self.is_running and self.mic_enabled:
                        sd.sleep(100)
                logger.info("Microphone stream closed.")
            except Exception as e:
                logger.error(f"InputStream error: {e}")
                time.sleep(2)

    def tts_worker(self):
        logger.info("TTS worker thread started")
        while self.is_running:
            try:
                task = self.tts_queue.get(timeout=1)
                text = task.get('text')
                voice = task.get('voice', 'af_sky')
                
                if not self.engine: continue

                self.interrupt_tts = False
                self.is_speaking_ai = True
                sentences = self.engine.split_into_sentences(text)
                for i, sentence in enumerate(sentences):
                    if not self.is_running or self.interrupt_tts: break
                    
                    wav_data = self.engine.generate_chunk_wav(sentence, voice=voice)
                    if self.interrupt_tts: break
                    
                    audio_b64 = base64.b64encode(wav_data).decode('utf-8')
                    self.send_to_electron("tts_chunk", {
                        "audio": audio_b64,
                        "index": i,
                        "isLast": i == len(sentences) - 1
                    })
                self.send_to_electron("tts_complete", {"interrupted": self.interrupt_tts})
                self.is_speaking_ai = False
            except queue.Empty:
                continue
            except Exception as e:
                logger.error(f"TTS error: {e}")
                self.is_speaking_ai = False

    def heartbeat_worker(self):
        while self.is_running:
            self.send_to_electron("heartbeat", {"time": time.time()})
            time.sleep(1)

    def run(self):
        threading.Thread(target=self.heartbeat_worker, daemon=True).start()
        threading.Thread(target=self.audio_loop, daemon=True).start()
        threading.Thread(target=self.processing_worker, daemon=True).start()
        threading.Thread(target=self.tts_worker, daemon=True).start()
        self.send_to_electron("alive", {})

        for line in sys.stdin:
            try:
                cmd = json.loads(line)
                action = cmd.get('action')
                payload = cmd.get('payload', {})

                if action == 'init':
                    self.initialize_engine()
                elif action == 'mic_on':
                    self.mic_enabled = True
                    self.mic_suppressed = False
                elif action == 'mic_off':
                    self.mic_enabled = False
                elif action == 'enroll_start':
                    self.enroll_mode = True
                    self.current_enroll_phrase = payload.get('phrase')
                    if self.engine:
                        self.engine.enrollment_embeddings = []
                elif action == 'enroll_next':
                    self.current_enroll_phrase = payload.get('phrase')
                elif action == 'enroll_stop':
                    self.enroll_mode = False
                    self.current_enroll_phrase = None
                    if self.engine:
                        name = payload.get('name', 'Primary_User')
                        profile = self.engine.finalize_enrollment(name)
                        self.send_to_electron("enroll_finalized", {"profile": profile, "name": name})
                elif action == 'set_profiles':
                    if self.engine:
                        profiles = payload.get('profiles', {})
                        self.engine.set_profiles(profiles)
                        self.send_to_electron("profiles_ready", {"count": len(profiles)})
                elif action == 'suppress_mic' or action == 'mic_suppress_on':
                    self.mic_suppressed = True
                elif action == 'resume_mic' or action == 'mic_suppress_off':
                    self.mic_suppressed = False
                elif action == 'speak':
                    self.tts_queue.put(payload)
                elif action == 'interrupt_tts':
                    self.interrupt_tts = True
                    # Clear queue
                    while not self.tts_queue.empty():
                        try: self.tts_queue.get_nowait()
                        except: break
                elif action == 'quit':
                    self.is_running = False
                    break
            except Exception as e:
                logger.error(f"Command error: {e}")

if __name__ == "__main__":
    sidecar = VoiceSidecar()
    sidecar.run()
