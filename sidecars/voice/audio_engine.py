import os
import torch
from faster_whisper import WhisperModel
import numpy as np
import warnings
import re
from kokoro_onnx import Kokoro
import soundfile as sf
import logging
import sys
import io

# Suppress noisy numpy warnings
warnings.filterwarnings("ignore", category=RuntimeWarning, module="faster_whisper")
np.seterr(divide='ignore', invalid='ignore', over='ignore')

logger = logging.getLogger("audio_engine")

class AudioEngine:
    def __init__(self):
        logger.info("Loading Faster-Whisper model (medium.en)...")
        self.transcriber = WhisperModel("medium.en", device="cpu", compute_type="int8")
        
        logger.info("Loading Kokoro TTS...")
        base_dir = os.path.dirname(os.path.abspath(__file__))
        model_path = os.path.join(base_dir, "kokoro-v1.0.onnx")
        voices_path = os.path.join(base_dir, "voices.bin")
        self.kokoro = Kokoro(model_path, voices_path)
        
    def transcribe(self, audio_data):
        segments, info = self.transcriber.transcribe(audio_data, beam_size=5)
        return "".join([segment.text for segment in segments]).strip()

    def split_into_sentences(self, text):
        """
        Split text into sentences intelligently.
        """
        # Split by punctuation followed by space or end of string
        sentences = re.split(r'(?<=[.!?])\s+', text)
        return [s.strip() for s in sentences if s.strip()]

    def generate_chunk_wav(self, text, voice="af_sky"):
        """
        Generates WAV bytes for a single chunk of text.
        """
        samples, sample_rate = self.kokoro.create(text, voice=voice, speed=1.0, lang="en-us")
        
        # Write to memory buffer instead of disk
        buffer = io.BytesIO()
        sf.write(buffer, samples, sample_rate, format='WAV')
        return buffer.getvalue()

    def process_segment(self, audio_data):
        if audio_data.dtype != np.float32:
            audio_np = audio_data.astype(np.float32) / 32768.0
        else:
            audio_np = audio_data
        
        text = self.transcribe(audio_np)
        return {"text": text, "speaker": "Unknown_Speaker"} if text else None
