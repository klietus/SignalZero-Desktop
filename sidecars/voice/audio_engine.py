import os
import torch
import threading
from faster_whisper import WhisperModel
import numpy as np
import warnings
import re
from kokoro_onnx import Kokoro
import soundfile as sf
import logging
import sys
import io
from scipy.spatial.distance import cosine
from speechbrain.inference.speaker import EncoderClassifier

# Suppress noisy numpy warnings
warnings.filterwarnings("ignore", category=RuntimeWarning, module="faster_whisper")
np.seterr(divide='ignore', invalid='ignore', over='ignore')

logger = logging.getLogger("audio_engine")

class AudioEngine:
    def __init__(self):
        self.transcriber_lock = threading.Lock()
        self.speaker_lock = threading.Lock()
        self.tts_lock = threading.Lock()
        self.profiles_lock = threading.Lock()
        
        logger.info("Loading Faster-Whisper model (medium.en)...")
        self.transcriber = WhisperModel("medium.en", device="cpu", compute_type="int8")
        
        logger.info("Loading Kokoro TTS...")
        base_dir = os.path.dirname(os.path.abspath(__file__))
        model_path = os.path.join(base_dir, "kokoro-v1.0.onnx")
        voices_path = os.path.join(base_dir, "voices.bin")
        self.kokoro = Kokoro(model_path, voices_path)

        logger.info("Loading Speaker Verification model (ECAPA-TDNN)...")
        self.speaker_classifier = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            run_opts={"device": "cpu"},
            savedir=os.path.join(base_dir, "spkrec-model")
        )
        
        # Multi-user support: { "name": embedding_numpy_array }
        self.user_profiles = {}
        self.enrollment_embeddings = []
        self.verification_threshold = 0.55 
        self.learning_rate = 0.1
        
    def get_speaker_embedding(self, audio_data):
        with self.speaker_lock:
            try:
                signal = torch.from_numpy(audio_data).unsqueeze(0)
                with torch.no_grad():
                    embeddings = self.speaker_classifier.encode_batch(signal)
                return embeddings.squeeze().cpu().numpy()
            except Exception as e:
                logger.error(f"Failed to extract speaker embedding: {e}")
                return None

    def enroll_chunk(self, audio_data):
        if audio_data.dtype != np.float32:
            audio_np = audio_data.astype(np.float32) / 32768.0
        else:
            audio_np = audio_data
            
        emb = self.get_speaker_embedding(audio_np)
        if emb is not None:
            with self.profiles_lock:
                self.enrollment_embeddings.append(emb)
            return True
        return False

    def finalize_enrollment(self, name):
        with self.profiles_lock:
            if not self.enrollment_embeddings:
                return None
                
            avg_emb = np.mean(self.enrollment_embeddings, axis=0)
            avg_emb = avg_emb / np.linalg.norm(avg_emb)
            
            self.user_profiles[name] = avg_emb
            self.enrollment_embeddings = []
            logger.info(f"Voice profile for '{name}' finalized.")
            return avg_emb.tolist()

    def set_profiles(self, profiles_dict):
        """
        Set multiple profiles: { "name": [embedding_list] }
        """
        with self.profiles_lock:
            self.user_profiles = {}
            for name, emb_list in profiles_dict.items():
                self.user_profiles[name] = np.array(emb_list)
            logger.info(f"Loaded {len(self.user_profiles)} voice profiles.")

    def identify_speaker(self, audio_data):
        """
        Identify which known user is speaking.
        Returns (name, similarity_score) or (None, highest_score)
        """
        with self.profiles_lock:
            if not self.user_profiles:
                return "Unknown_Speaker", 0.0
            # Take a snapshot of profiles to minimize lock time
            current_profiles = list(self.user_profiles.items())
            
        emb = self.get_speaker_embedding(audio_data)
        if emb is None:
            return "Error", 0.0
            
        emb = emb / np.linalg.norm(emb)
        
        best_name = None
        best_score = -1.0
        
        for name, profile_emb in current_profiles:
            similarity = 1 - cosine(profile_emb, emb)
            if similarity > best_score:
                best_score = similarity
                best_name = name
                
        if best_score >= self.verification_threshold:
            return best_name, best_score
        else:
            return None, best_score

    def refine_speaker_profile(self, name, audio_data, custom_lr=None):
        """
        Update an existing speaker profile with new high-confidence data.
        Uses a moving average to refine the embedding.
        """
        new_emb = self.get_speaker_embedding(audio_data)
        if new_emb is None:
            return None
            
        new_emb = new_emb / np.linalg.norm(new_emb)
        lr = custom_lr if custom_lr is not None else self.learning_rate
        
        with self.profiles_lock:
            if name in self.user_profiles:
                old_emb = self.user_profiles[name]
                # Weighted moving average: (1-LR)*old + LR*new
                updated_emb = ((1 - lr) * old_emb) + (lr * new_emb)
                # Re-normalize
                updated_emb = updated_emb / np.linalg.norm(updated_emb)
                self.user_profiles[name] = updated_emb
                logger.info(f"Refined voice profile for '{name}' (LR: {lr:.3f}).")
                return updated_emb.tolist()
        return None

    def transcribe(self, audio_data):
        with self.transcriber_lock:
            segments, info = self.transcriber.transcribe(audio_data, beam_size=5)
            return "".join([segment.text for segment in segments]).strip()

    def split_into_sentences(self, text):
        sentences = re.split(r'(?<=[.!?])\s+', text)
        return [s.strip() for s in sentences if s.strip()]

    def generate_chunk_wav(self, text, voice="af_sky"):
        with self.tts_lock:
            samples, sample_rate = self.kokoro.create(text, voice=voice, speed=1.0, lang="en-us")
            buffer = io.BytesIO()
            sf.write(buffer, samples, sample_rate, format='WAV')
            return buffer.getvalue()

    def process_segment(self, audio_data):
        if audio_data.dtype != np.float32:
            audio_np = audio_data.astype(np.float32) / 32768.0
        else:
            audio_np = audio_data
        
        speaker_name, score = self.identify_speaker(audio_np)
        
        if speaker_name is None:
            logger.info(f"Speaker verification failed. Best score: {score:.4f} (Threshold: {self.verification_threshold})")
            return None
            
        logger.info(f"Speaker verified as '{speaker_name}' (Score: {score:.4f})")
        text = self.transcribe(audio_np)
        
        return {
            "text": text,
            "speaker": speaker_name,
            "score": score
        }
