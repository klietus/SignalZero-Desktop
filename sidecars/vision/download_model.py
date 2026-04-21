import requests
import os

def download_model():
    url = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
    target = os.path.join(os.path.dirname(__file__), "face_landmarker.task")
    
    if os.path.exists(target):
        print(f"Model already exists at {target}")
        return

    print(f"Downloading MediaPipe Face Landmarker model...")
    response = requests.get(url, stream=True)
    response.raise_for_status()
    
    with open(target, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)
    
    print(f"Model downloaded successfully to {target}")

if __name__ == "__main__":
    download_model()
