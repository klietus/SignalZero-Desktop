import numpy as np
from scipy.spatial.distance import cosine
import logging

logger = logging.getLogger("diarization")

class DiarizationEngine:
    def __init__(self, threshold=0.5):
        self.threshold = threshold
        self.speakers = {} # id -> list of embeddings
        self.speaker_count = 0

    def cluster(self, embedding):
        if embedding is None: return "unknown"
        
        best_speaker = None
        best_score = -1.0
        
        for speaker_id, embeddings in self.speakers.items():
            # Compare with the average embedding of each known cluster
            avg_emb = np.mean(embeddings, axis=0)
            score = 1 - cosine(avg_emb, embedding)
            if score > best_score:
                best_score = score
                best_speaker = speaker_id
        
        if best_score > self.threshold:
            self.speakers[best_speaker].append(embedding)
            # Limit history
            if len(self.speakers[best_speaker]) > 20:
                self.speakers[best_speaker].pop(0)
            return best_speaker
        else:
            self.speaker_count += 1
            new_id = f"guest_{self.speaker_count}"
            self.speakers[new_id] = [embedding]
            return new_id

    def reset(self):
        self.speakers = {}
        self.speaker_count = 0
