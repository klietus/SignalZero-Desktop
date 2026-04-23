import { loggerService, LogCategory } from './loggerService.js';

export type BroadcastHandler = (channel: string, ...args: any[]) => void;

class UiStateService {
    private _activeSessionId: string | null = null;
    private _broadcastHandler: BroadcastHandler | null = null;

    /**
     * Set the currently active session ID in the UI.
     */
    setActiveSessionId(id: string | null) {
        this._activeSessionId = id;
        loggerService.catDebug(LogCategory.SYSTEM, `UI State: Active session changed to ${id}`);
    }

    get activeSessionId(): string | null {
        return this._activeSessionId;
    }

    /**
     * Register the actual Electron broadcast function from the main process.
     */
    registerBroadcastHandler(handler: BroadcastHandler) {
        this._broadcastHandler = handler;
    }

    /**
     * Safely broadcast a message to the renderer windows.
     */
    broadcast(channel: string, ...args: any[]) {
        if (this._broadcastHandler) {
            this._broadcastHandler(channel, ...args);
        } else {
            loggerService.catWarn(LogCategory.SYSTEM, `UI State: Attempted to broadcast to '${channel}' but no handler is registered.`);
        }
    }
}

export const uiStateService = new UiStateService();
