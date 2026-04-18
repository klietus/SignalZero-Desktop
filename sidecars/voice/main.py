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
RMS_THRESHOLD = 0.01

class VoiceSidecar:
    def __init__(self):
        self.engine = None
        self.vad = webrtcvad.Vad(VAD_MODE)
        self.mic_enabled = False
        self.mic_suppressed = False
        self.is_running = True
        self.tts_queue = queue.Queue()
        self.device_index = None
        self.triggered = False
        self.speech_frames = []
        self.silence_counter = 0

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
            logger.info("Initializing Python Audio Engine...")
            self.engine = AudioEngine() 
            self.device_index = self.find_input_device()
            if self.device_index is None:
                self.send_to_electron("error", {"message": "No microphone found"})
            else:
                self.send_to_electron("ready", {"status": "initialized", "device": self.device_index})
        except Exception as e:
            logger.error(f"Failed to initialize engine: {e}")
            self.send_to_electron("error", {"message": str(e)})

    def audio_callback(self, indata, frames, time_info, status):
        if not self.mic_enabled or self.mic_suppressed:
            if self.triggered:
                self.triggered = False
                self.speech_frames = []
            return

        audio_frame = indata.flatten()
        rms = np.sqrt(np.mean(audio_frame**2))
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
            self.silence_counter = 0
            self.speech_frames.append(audio_frame)
        elif self.triggered:
            self.speech_frames.append(audio_frame)
            self.silence_counter += 1
            if self.silence_counter > SILENCE_CHUNKS:
                self.triggered = False
                self.silence_counter = 0
                
                audio_np = np.concatenate(self.speech_frames)
                self.speech_frames = []

                if len(audio_np) >= SAMPLE_RATE * 0.5:
                    result = self.engine.process_segment(audio_np)
                    if result and result.get('text'):
                        self.send_to_electron("stt_result", {"text": result['text'].strip()})

    def audio_loop(self):
        while self.is_running:
            if self.device_index is None:
                time.sleep(1)
                continue
            try:
                with sd.InputStream(samplerate=SAMPLE_RATE, device=self.device_index, channels=1, callback=self.audio_callback, blocksize=CHUNK_SIZE):
                    while self.is_running and self.device_index is not None:
                        sd.sleep(100)
            except Exception as e:
                logger.error(f"Stream error: {e}")
                time.sleep(5)

    def tts_worker(self):
        while self.is_running:
            try:
                task = self.tts_queue.get(timeout=1)
                text = task.get('text')
                voice = task.get('voice', 'af_sky')
                
                logger.info(f"Processing streaming TTS request...")
                
                sentences = self.engine.split_into_sentences(text)
                for i, sentence in enumerate(sentences):
                    if not self.is_running: break
                    
                    logger.info(f"Generating chunk {i+1}/{len(sentences)}...")
                    wav_data = self.engine.generate_chunk_wav(sentence, voice=voice)
                    audio_b64 = base64.b64encode(wav_data).decode('utf-8')
                    
                    self.send_to_electron("tts_chunk", {
                        "audio": audio_b64,
                        "index": i,
                        "is_last": i == len(sentences) - 1
                    })
                
                self.send_to_electron("tts_complete", {})
            except queue.Empty:
                continue
            except Exception as e:
                logger.error(f"TTS error: {e}")
                self.send_to_electron("error", {"message": f"TTS generation error: {e}"})

    def run(self):
        threading.Thread(target=self.audio_loop, daemon=True).start()
        threading.Thread(target=self.tts_worker, daemon=True).start()

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
                elif action == 'suppress_mic':
                    self.mic_suppressed = True
                elif action == 'resume_mic':
                    self.mic_suppressed = False
                elif action == 'speak':
                    self.tts_queue.put(payload)
                elif action == 'quit':
                    self.is_running = False
                    break
            except Exception as e:
                logger.error(f"Command error: {e}")

if __name__ == "__main__":
    sidecar = VoiceSidecar()
    sidecar.run()
