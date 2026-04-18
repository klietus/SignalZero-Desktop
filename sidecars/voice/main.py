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
VAD_MODE = 3
SILENCE_THRESHOLD_MS = 2000
SILENCE_CHUNKS = int(SILENCE_THRESHOLD_MS / CHUNK_DURATION_MS)
RMS_THRESHOLD = 0.005 

class VoiceSidecar:
    def __init__(self):
        self.engine = None
        self.vad = webrtcvad.Vad(VAD_MODE)
        self.mic_enabled = False
        self.mic_suppressed = False
        self.enroll_mode = False
        self.current_enroll_phrase = None
        self.is_running = True
        self.tts_queue = queue.Queue()
        self.interrupt_tts = False
        self.device_index = None
        self.triggered = False
        self.speech_frames = []
        self.silence_counter = 0
        self.callback_count = 0
        self.early_id_sent = False
        self.early_id_threshold = 20 # ~600ms (20 * 30ms)

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
        
        if not self.mic_enabled or self.mic_suppressed:
            if self.triggered:
                self.triggered = False
                self.speech_frames = []
            return

        pcm_frame = (audio_frame * 32768).astype(np.int16).tobytes()
        
        is_speech = False
        if rms > RMS_THRESHOLD:
            try:
                is_speech = self.vad.is_speech(pcm_frame, SAMPLE_RATE)
            except:
                pass
        
        if is_speech:
            if not self.triggered:
                self.send_to_electron("speech_start", {})
                self.triggered = True
                self.early_id_sent = False
            self.silence_counter = 0
            self.speech_frames.append(audio_frame)

            # Early Speaker ID for interruption
            if self.engine and not self.early_id_sent and len(self.speech_frames) >= self.early_id_threshold:
                audio_segment = np.concatenate(self.speech_frames)
                speaker_name, score = self.engine.identify_speaker(audio_segment)
                if speaker_name and speaker_name != "Unknown_Speaker":
                    self.send_to_electron("speaker_interrupt", {"speaker": speaker_name, "score": score})
                    self.early_id_sent = True
        elif self.triggered:
            self.speech_frames.append(audio_frame)
            self.silence_counter += 1
            if self.silence_counter > SILENCE_CHUNKS:
                self.triggered = False
                self.silence_counter = 0
                
                audio_np = np.concatenate(self.speech_frames)
                self.speech_frames = []

                if len(audio_np) >= SAMPLE_RATE * 0.5:
                    if self.enroll_mode:
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
                    elif self.engine:
                        result = self.engine.process_segment(audio_np)
                        if result and result.get('text'):
                            self.send_to_electron("stt_result", {
                                "text": result['text'].strip(),
                                "speaker": result.get('speaker', 'Unknown')
                            })

    def audio_loop(self):
        logger.info("Audio loop thread started")
        self.device_index = self.find_input_device()
        while self.is_running:
            if self.device_index is None:
                self.device_index = self.find_input_device()
                if self.device_index is None:
                    time.sleep(1)
                    continue
            try:
                with sd.InputStream(samplerate=SAMPLE_RATE, device=self.device_index, channels=1, callback=self.audio_callback, blocksize=CHUNK_SIZE):
                    while self.is_running and self.device_index is not None:
                        sd.sleep(100)
            except Exception as e:
                logger.error(f"InputStream error: {e}")
                time.sleep(2)

    def tts_worker(self):
        while self.is_running:
            try:
                task = self.tts_queue.get(timeout=1)
                text = task.get('text')
                voice = task.get('voice', 'af_sky')
                
                if not self.engine: continue

                self.interrupt_tts = False
                sentences = self.engine.split_into_sentences(text)
                for i, sentence in enumerate(sentences):
                    if not self.is_running or self.interrupt_tts: break
                    wav_data = self.engine.generate_chunk_wav(sentence, voice=voice)
                    audio_b64 = base64.b64encode(wav_data).decode('utf-8')
                    self.send_to_electron("tts_chunk", {
                        "audio": audio_b64,
                        "index": i,
                        "isLast": i == len(sentences) - 1
                    })
                self.send_to_electron("tts_complete", {"interrupted": self.interrupt_tts})
            except queue.Empty:
                continue
            except Exception as e:
                logger.error(f"TTS error: {e}")

    def heartbeat_worker(self):
        while self.is_running:
            self.send_to_electron("heartbeat", {"time": time.time()})
            time.sleep(1)

    def run(self):
        threading.Thread(target=self.heartbeat_worker, daemon=True).start()
        threading.Thread(target=self.audio_loop, daemon=True).start()
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
                elif action == 'suppress_mic':
                    self.mic_suppressed = True
                elif action == 'resume_mic':
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
