
import { EventEmitter } from 'events';

export enum KernelEventType {
    SYMBOL_UPSERTED = 'symbol:upserted',
    SYMBOL_DELETED = 'symbol:deleted',
    DOMAIN_CREATED = 'domain:created',
    CONTEXT_CREATED = 'context:created',
    CONTEXT_UPDATED = 'context:updated',
    CONTEXT_CLOSED = 'context:closed',
    TRACE_LOGGED = 'trace:logged',
    INFERENCE_STARTED = 'inference:started',
    INFERENCE_CHUNK = 'inference:chunk',
    INFERENCE_COMPLETED = 'inference:completed',
    INFERENCE_ERROR = 'inference:error',
    INFERENCE_TOKENS = 'inference:tokens',
    CACHE_LOAD = 'cache:load',
    AGENT_HEARTBEAT = 'agent:heartbeat',
    PROJECT_IMPORT_STATUS = 'project:import-status',
    SYSTEM_LOG = 'system:log',
    SYMBOL_COMPRESSION = 'symbol:compression',
    ORPHAN_DETECTED = 'orphan:detected',
    TENTATIVE_LINK_CREATE = 'tentative:create',
    TENTATIVE_LINK_DELETE = 'tentative:delete'
}

class EventBusService extends EventEmitter {
    emitKernelEvent(type: KernelEventType, payload: any) {
        this.emit(type, payload);
        
        // In Electron, we might also want to broadcast to the renderer
        // This will be handled in the IPC bridge later
    }

    onKernelEvent(type: KernelEventType, handler: (payload: any) => void) {
        this.on(type, handler);
    }
}

export const eventBusService = new EventBusService();
