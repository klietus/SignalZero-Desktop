
import { EventEmitter } from 'events';
import { KernelEventType, KernelEventPayloadFor } from '../types.js';

class EventBusService extends EventEmitter {
    emitKernelEvent<T extends KernelEventType | 'monitoring:delta-created' | 'perception:spike-promoted'>(
        type: T,
        payload: KernelEventPayloadFor<T>
    ): void {
        this.emit(type, payload);
    }

    onKernelEvent(
        type: KernelEventType | 'monitoring:delta-created' | 'perception:spike-promoted',
        handler: (payload: unknown) => void
    ): this {
        return this.on(type, handler);
    }

    offKernelEvent(
        type: KernelEventType | 'monitoring:delta-created' | 'perception:spike-promoted',
        handler: (payload: unknown) => void
    ): this {
        return this.off(type, handler);
    }
}

export const eventBusService = new EventBusService();
