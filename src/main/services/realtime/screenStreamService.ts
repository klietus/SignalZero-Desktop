import { visionProcess } from './visionProcess.js';
import { sceneManager } from './sceneManager.js';
import { ScreenStreamState } from './types.js';

class ScreenStreamService {
    constructor() {
        this.initialize();
    }

    private async initialize() {
        await visionProcess.initialize();
        
        visionProcess.on('message', (msg) => {
            if (msg.type === 'screen_update') {
                this.handleUpdate(msg.payload);
            }
        });
    }

    private handleUpdate(payload: Partial<ScreenStreamState>) {
        sceneManager.updateScreen(payload);
    }

    start() {
        visionProcess.send('start_screen', {});
        sceneManager.updateStatus('screen', { isActive: true });
    }

    stop() {
        visionProcess.send('stop_screen', {});
        sceneManager.updateStatus('screen', { isActive: false });
    }
}

export const screenStreamService = new ScreenStreamService();
