import { describe, it, expect, vi, beforeEach } from 'vitest';
import { visionProcess } from '../services/realtime/visionProcess.js';
import { spawn } from 'child_process';
import EventEmitter from 'events';

vi.mock('child_process', () => ({
    spawn: vi.fn()
}));

describe('VisionProcess', () => {
    let mockProcess: any;

    beforeEach(() => {
        vi.clearAllMocks();
        visionProcess.resetForTest();
        mockProcess = {
            stdout: new EventEmitter(),
            stderr: new EventEmitter(),
            stdin: {
                write: vi.fn()
            },
            on: vi.fn(),
            kill: vi.fn()
        };
        (spawn as any).mockReturnValue(mockProcess);
    });

    it('should initialize and spawn the sidecar process', async () => {
        await visionProcess.initialize();
        expect(spawn).toHaveBeenCalled();
    });

    it.skip('should handle incoming JSON messages from stdout', async () => {
        await visionProcess.initialize();
        
        const messagePromise = new Promise((resolve) => {
            visionProcess.once('message', (msg) => {
                resolve(msg);
            });
        });

        const testMsg = { type: 'log', payload: 'test message' };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify(testMsg) + '\n'));

        const receivedMsg = await messagePromise;
        expect(receivedMsg).toEqual(testMsg);
    }, 10000);

    it('should emit messages on vision events', async () => {
        await visionProcess.initialize();
        
        const updatePromise = new Promise((resolve) => {
            visionProcess.once('message', (msg) => {
                if (msg.type === 'camera_update') resolve(msg.payload);
            });
        });

        const cameraData = { lastFrame: 'data:image/jpeg...', people: [] };
        mockProcess.stdout.emit('data', Buffer.from(JSON.stringify({ type: 'camera_update', payload: cameraData }) + '\n'));

        const payload = await updatePromise;
        expect(payload).toEqual(cameraData);
    });
});
