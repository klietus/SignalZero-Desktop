import { visionProcess } from './visionProcess.js';
import { sceneManager } from './sceneManager.js';
import { CameraStreamState } from './types.js';

class CameraStreamService {
    constructor() {
        this.initialize();
    }

    private async initialize() {
        await visionProcess.initialize();
        
        visionProcess.on('message', (msg) => {
            if (msg.type === 'camera_update') {
                this.handleUpdate(msg.payload);
            }
        });
    }

    private handleUpdate(payload: Partial<CameraStreamState>) {
        sceneManager.updateCamera(payload);
    }

    start() {
        visionProcess.send('start_camera', {});
        sceneManager.updateStatus('camera', { isActive: true });
    }

    stop() {
        visionProcess.send('stop_camera', {});
        sceneManager.updateStatus('camera', { isActive: false });
    }
}

export const cameraStreamService = new CameraStreamService();
