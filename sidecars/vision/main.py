import sys
import json
import time
import threading
import cv2
import numpy as np
import mediapipe as mp
import base64
from PIL import Image
import mss
import io
import subprocess
import os
import functools

# Research-backed Emotion Recognition
try:
    import torch
    # PyTorch 2.6+ compatibility patch
    _orig_load = torch.load
    @functools.wraps(_orig_load)
    def _patched_load(*args, **kwargs):
        if 'weights_only' not in kwargs:
            kwargs['weights_only'] = False
        return _orig_load(*args, **kwargs)
    torch.load = _patched_load

    from hsemotion.facial_emotions import HSEmotionRecognizer
except ImportError:
    HSEmotionRecognizer = None

class CalibrationEngine:
    def __init__(self):
        self.samples = []
        self.baseline = {}
        self.is_calibrated = False
        self.max_samples = 30 # ~10 seconds for a rock-solid baseline

    def add_sample(self, blendshapes):
        if self.is_calibrated: return
        self.samples.append(blendshapes)
        if len(self.samples) >= self.max_samples:
            # Average the samples to find the resting face baseline
            for name in blendshapes.keys():
                self.baseline[name] = sum(s[name] for s in self.samples) / len(self.samples)
            self.is_calibrated = True

    def get_delta(self, name, value):
        if not self.is_calibrated: return value
        # We use a thresholded delta to ignore minor fluctuations
        diff = value - self.baseline.get(name, 0)
        return max(0, diff)

class VisionSidecar:
# ... (init and properties remain same)
    def __init__(self):
        self.log("VisionSidecar Instance Creating...")
        self.camera_running = False
        self.screen_running = False
        self.camera_thread = None
        self.screen_thread = None
        
        try:
            self.sct = mss.mss()
            self.log("MSS (Screen Capture) initialized.")
        except Exception as e:
            self.log(f"MSS INIT ERROR: {str(e)}")
            self.sct = None
        
        # Lazy load models
        self._face_landmarker = None
        self._fer = None 

        self.calibration = CalibrationEngine()
        self.emotion_history = {} 
        self.smoothing_window = 10

    @property
    def face_landmarker(self):
        if self._face_landmarker is None:
            try:
                # Correct import paths for MediaPipe Tasks API
                from mediapipe.tasks import python
                from mediapipe.tasks.python import vision

                BaseOptions = python.BaseOptions
                FaceLandmarker = vision.FaceLandmarker
                FaceLandmarkerOptions = vision.FaceLandmarkerOptions
                VisionRunningMode = vision.RunningMode

                # We need a model file. We'll look for it or log missing.
                model_path = os.path.join(os.path.dirname(__file__), 'face_landmarker.task')
                if not os.path.exists(model_path):
                    self.log(f"Face Landmarker model NOT FOUND at {model_path}. Falling back to detection only.")
                    return None

                options = FaceLandmarkerOptions(
                    base_options=BaseOptions(
                        model_asset_path=model_path,
                        delegate=BaseOptions.Delegate.GPU # Force M4 Max GPU
                    ),
                    running_mode=VisionRunningMode.VIDEO,
                    output_face_blendshapes=True,
                    num_faces=5,
                    min_face_detection_confidence=0.7,
                    min_tracking_confidence=0.7
                )
                self._face_landmarker = FaceLandmarker.create_from_options(options)
                self.log("MediaPipe Face Landmarker (V2) initialized.")
            except Exception as e:
                self.log(f"Failed to init Face Landmarker: {str(e)}")
        return self._face_landmarker

    @property
    def fer(self):
        if self._fer is None:
            if HSEmotionRecognizer is None:
                return None
            try:
                device = 'cpu'
                if sys.platform == 'darwin':
                    try:
                        import torch
                        if torch.backends.mps.is_available():
                            device = 'mps'
                    except: pass
                self._fer = HSEmotionRecognizer(model_name='enet_b0_8_best_vgaf', device=device)
                self.log(f"HSEmotion initialized on {device}.")
            except Exception as e:
                self.log(f"FER INIT ERROR: {str(e)}")
        return self._fer

    def log(self, msg):
        print(json.dumps({"type": "log", "payload": msg}), flush=True)

    def emit(self, type, payload):
        print(json.dumps({"type": type, "payload": payload}), flush=True)

    def classify_emotion(self, neural_emotion, blendshapes):
        """
        Consensus logic: Cross-check Neural result with physical Blendshapes.
        Addresses 'Anger' and 'Disgust' bias by checking specific physical movements.
        """
        # 1. Extract physical indicators (calibrated deltas)
        brow_down = (self.calibration.get_delta('browDownLeft', blendshapes.get('browDownLeft', 0)) + 
                     self.calibration.get_delta('browDownRight', blendshapes.get('browDownRight', 0))) / 2.0
        
        nose_sneer = (self.calibration.get_delta('noseSneerLeft', blendshapes.get('noseSneerLeft', 0)) + 
                      self.calibration.get_delta('noseSneerRight', blendshapes.get('noseSneerRight', 0))) / 2.0
        
        mouth_smile = (self.calibration.get_delta('mouthSmileLeft', blendshapes.get('mouthSmileLeft', 0)) + 
                       self.calibration.get_delta('mouthSmileRight', blendshapes.get('mouthSmileRight', 0))) / 2.0
        
        mouth_frown = (self.calibration.get_delta('mouthFrownLeft', blendshapes.get('mouthFrownLeft', 0)) + 
                       self.calibration.get_delta('mouthFrownRight', blendshapes.get('mouthFrownRight', 0))) / 2.0

        mouth_press = (self.calibration.get_delta('mouthPressLeft', blendshapes.get('mouthPressLeft', 0)) + 
                       self.calibration.get_delta('mouthPressRight', blendshapes.get('mouthPressRight', 0))) / 2.0
        
        eye_wide = (self.calibration.get_delta('eyeWideLeft', blendshapes.get('eyeWideLeft', 0)) + 
                    self.calibration.get_delta('eyeWideRight', blendshapes.get('eyeWideRight', 0))) / 2.0
        
        eye_blink = (blendshapes.get('eyeBlinkLeft', 0) + blendshapes.get('eyeBlinkRight', 0)) / 2.0

        # 2. Total "Arousal" (Expression Intensity)
        # Sum of major expressive movements. If this is very low, the face is physically neutral.
        intensity = brow_down + nose_sneer + mouth_smile + mouth_frown + mouth_press + eye_wide
        
        # Override Logic
        if eye_blink > 0.75: return "blinking"
        
        # If the face is physically static, force Neutral regardless of neural engine
        if intensity < 0.15:
            return "neutral"

        if neural_emotion == "anger":
            # Real anger requires significant brow lowering AND usually mouth tension
            if brow_down < 0.35:
                return "neutral"
            if mouth_press < 0.1 and mouth_frown < 0.1:
                return "focused" # If brows are down but mouth is relaxed, it's focus

        if neural_emotion == "disgust":
            # Real disgust MUST have nose sneer or extreme upper lip elevation
            if nose_sneer < 0.25:
                return "neutral"

        if neural_emotion == "neutral":
            if mouth_smile > 0.4: return "happy"
            if brow_down > 0.5: return "focused"

        return neural_emotion

    def process_frame(self, frame, timestamp_ms):
        # Convert BGR to RGBA - MediaPipe GPU delegate on macOS prefers 4-channel alignment
        rgba_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGBA)
        # Ensure the array is C-contiguous for memory mapping
        rgba_frame = np.ascontiguousarray(rgba_frame)
        
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGBA, data=rgba_frame)
        h, w, _ = frame.shape
        people = []
        has_people = False
        
        landmarker = self.face_landmarker
        recognizer = self.fer
        
        if not landmarker: return [], [], False

        try:
            results = landmarker.detect_for_video( mp_image, int(timestamp_ms))
            
            if not results.face_landmarks: 
                return [], [], False

            has_people = True
            # Use the RGB version for neural inference (HSEmotion expects 3 channels)
            rgb_frame = cv2.cvtColor(rgba_frame, cv2.COLOR_RGBA2RGB)

            for i, landmarks in enumerate(results.face_landmarks):
                # Get Blendshapes
                blendshape_scores = {}
                if results.face_blendshapes:
                    for category in results.face_blendshapes[i]:
                        blendshape_scores[category.category_name] = category.score
                
                self.calibration.add_sample(blendshape_scores)

                # Get BBox from landmarks
                x_coords = [lm.x for lm in landmarks]
                y_coords = [lm.y for lm in landmarks]
                xmin, xmax = min(x_coords), max(x_coords)
                ymin, ymax = min(y_coords), max(y_coords)
                bw, bh = xmax - xmin, ymax - ymin
                
                # Inference for Neural Emotion
                emotion = "neutral"
                emotion_scores = {}
                px1, py1 = max(0, int((xmin - bw*0.1)*w)), max(0, int((ymin - bh*0.1)*h))
                px2, py2 = min(w, int((xmax + bw*0.1)*w)), min(h, int((ymax + bh*0.1)*h))
                face_img = rgb_frame[py1:py2, px1:px2]

                if recognizer and face_img.size > 0:
                    try:
                        # 1. Raw HSEmotion Prediction
                        _, raw_scores = recognizer.predict_emotions(face_img, logits=False)
                        
                        # 2. Clean and convert to dict with NaN safety
                        labels = ['anger', 'contempt', 'disgust', 'fear', 'happiness', 'neutral', 'sadness', 'surprise']
                        current_scores = {}
                        for j, label in enumerate(labels):
                            val = float(raw_scores[j])
                            if np.isnan(val) or np.isinf(val): val = 0.0
                            current_scores[label] = val

                        # 3. Shave 20% off hostile emotions as requested
                        current_scores['anger'] *= 0.8
                        current_scores['contempt'] *= 0.8
                        
                        # 4. Re-normalize to ensure sum is 1.0
                        total = sum(current_scores.values())
                        if total > 0:
                            for l in labels:
                                current_scores[l] /= total
                        
                        # 5. Determine rebalanced winner
                        best_neural_emotion = max(current_scores, key=current_scores.get)
                        emotion_scores = current_scores
                        
                        # 6. Apply physical blendshape override (consensus)
                        emotion = self.classify_emotion(best_neural_emotion, blendshape_scores)
                    except Exception as e:
                        self.log(f"Inference error: {str(e)}")
                        emotion = "error"
                
                # Smoothing
                face_id = f"face_{i}"
                history = self.emotion_history.get(face_id, [])
                history.append(emotion)
                if len(history) > self.smoothing_window: history.pop(0)
                self.emotion_history[face_id] = history
                final_emotion = max(set(history), key=history.count)

                people.append({
                    "id": str(i),
                    "expression": final_emotion,
                    "attributes": {
                        "calibrated": self.calibration.is_calibrated,
                        "detection_confidence": float(1.0), # tasks API doesn't give direct per-face conf in this structure easily
                        "emotion_scores": emotion_scores,
                        "blendshapes": blendshape_scores if i == 0 else {} # Only send for first face to save BW
                    },
                    "bbox": [xmin * 100, ymin * 100, bw * 100, bh * 100]
                })

        except Exception as e:
            self.log(f"Processing error: {str(e)}")

        return people, [], has_people

    def camera_loop(self):
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            self.log("Error: Could not open camera.")
            self.camera_running = False
            return

        self.log("Camera loop active.")
        start_time = time.time()
        while self.camera_running:
            ret, frame = cap.read()
            if not ret: break

            ts_ms = (time.time() - start_time) * 1000
            people, _, has_people = self.process_frame(frame, ts_ms)
            
            target_width = 640
            h_orig, w_orig = frame.shape[:2]
            target_height = int(h_orig * (target_width / w_orig))
            small_frame = cv2.resize(frame, (target_width, target_height))
            _, buffer = cv2.imencode('.jpg', small_frame, [cv2.IMWRITE_JPEG_QUALITY, 50])
            frame_data = f"data:image/jpeg;base64,{base64.b64encode(buffer).decode('utf-8')}"

            self.emit("camera_update", {
                "lastFrame": frame_data,
                "detectedObjects": [],
                "people": people,
                "hasPeople": has_people,
                "timestamp": time.time()
            })
            time.sleep(0.1) # 10 FPS

        cap.release()

    def get_active_app_info(self):
        try:
            # Improved AppleScript that checks for window existence to avoid -1719 error
            script = '''
            tell application "System Events"
                set p to first process whose frontmost is true
                set pName to name of p
                if (count of windows of p) > 0 then
                    set wTitle to title of window 1 of p
                    return pName & ": " & wTitle
                else
                    return pName
                end if
            end tell
            '''
            return subprocess.check_output(['osascript', '-e', script]).decode('utf-8').strip()
        except: return "Unknown"

    def screen_loop(self):
        while self.screen_running:
            try:
                monitor = self.sct.monitors[1]
                sct_img = self.sct.grab(monitor)
                img = Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
                frame = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
                active_app = self.get_active_app_info()
                
                small_frame = cv2.resize(frame, (640, int(640 * frame.shape[0] / frame.shape[1])))
                _, buffer = cv2.imencode('.jpg', small_frame, [cv2.IMWRITE_JPEG_QUALITY, 40])
                frame_data = f"data:image/jpeg;base64,{base64.b64encode(buffer).decode('utf-8')}"

                self.emit("screen_update", {
                    "lastFrame": frame_data,
                    "activeApplication": active_app,
                    "ocrText": "OCR Active",
                    "timestamp": time.time()
                })
            except: pass
            time.sleep(1.0)

    def start_camera(self):
        if not self.camera_running:
            self.camera_running = True
            threading.Thread(target=self.camera_loop, daemon=True).start()

    def stop_camera(self): self.camera_running = False

    def start_screen(self):
        if not self.screen_running:
            self.screen_running = True
            threading.Thread(target=self.screen_loop, daemon=True).start()

    def stop_screen(self): self.screen_running = False

if __name__ == "__main__":
    sidecar = VisionSidecar()
    for line in sys.stdin:
        try:
            cmd = json.loads(line)
            action = cmd.get("action")
            if action == "start_camera": sidecar.start_camera()
            elif action == "stop_camera": sidecar.stop_camera()
            elif action == "start_screen": sidecar.start_screen()
            elif action == "stop_screen": sidecar.stop_screen()
            elif action == "quit": break
        except: pass
