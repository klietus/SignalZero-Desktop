# Interrupt-Driven Inference Architecture — Implementation Plan

## Overview

Shift from a **user-message-centric** inference model to a **task-centric interrupt-driven** architecture. Every piece of work — user messages, perception spikes, world deltas, agent rounds — becomes a task in a priority queue. Each task runs its own OODA cycle. The `finish_task` tool replaces the fixed tool-round limit as the completion signal. Higher-priority interrupts preempt lower-priority tasks via page-out/page-in of their full state.

---

## Current Architecture (Baseline)

| Component | Current Role |
|-----------|-------------|
| `processMessageAsync` | Entry point for user messages only |
| `sendMessageAndHandleTools` | 15-round tool loop with narrative termination |
| `primeSymbolicContext` | Fast-model pre-inference priming |
| `contextWindowService` | 7-part context window (mature/new symbols split) |
| `alertTriggerService` | Post-inference alert triggering (sequential) |
| `agentRunner` | Batch delta routing via WTA, runs every 5 min |
| `monitoringService` | World delta polling, delta creation events |

**Current termination:** Fixed `MAX_TOOL_LOOPS = 15` + narrative check + audit retry.

**Current flow:** User message → prime → sendMessageAndHandleTools → stream → done. Agent rounds are a separate code path. Alerts chain after inference completes.

---

## Target Architecture

```
                    ┌─────────────────────────────────┐
                    │     Interrupt Priority Queue     │
                    │  (1) User Message (URGENT)       │
                    │  (2) Perception Spike (HIGH)     │
                    │  (3) Agent Round (MEDIUM)        │
                    │  (4) World Delta (LOW/BG)        │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │     Interrupt Orchestrator        │
                    │  - Pops highest priority          │
                    │  - Pages in task state            │
                    │  - Runs OODA cycle                │
                    │  - Pages out on preemption        │
                    └──────────────┬──────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
    ┌─────────▼────────┐  ┌───────▼────────┐  ┌───────▼────────┐
    │   User Task      │  │  Perception    │  │  Background    │
    │   OODA Cycle     │  │  Task OODA     │  │  Task OODA     │
    │                  │  │                │  │                │
    │ Observe: capture │  │ Observe:       │  │ Observe:       │
    │   scene, prime   │  │   assess spike │  │   process      │
    │   context        │  │                │  │   deltas       │
    │ Orient: prime    │  │ Orient:        │  │                │
    │   symbolic ctx   │  │   map to       │  │                │
    │ Decide: set task │  │   symbolic     │  │                │
    │   list (if any)  │  │   graph        │  │                │
    │ Act: tool calls  │  │ Decide: update │  │                │
    │   + finish_task  │  │   graph        │  │                │
    └──────────────────┘  └────────────────┘  └────────────────┘
```

---

## Task Definition

```typescript
interface Task {
  id: string;
  type: 'user_message' | 'perception_spike' | 'agent_round' | 'world_delta' | 'background_delta';
  priority: number; // 1 = highest (urgent), 4 = lowest (background)
  sessionId: string;
  state: TaskState;
  metadata: Record<string, any>;
  createdAt: number;
  completedAt?: number;
}

interface TaskState {
  // The full transient state of the OODA cycle
  observe: string;           // What was observed (scene, delta content, etc.)
  orient: string;            // Oriented context (primed symbols, world state)
  decide: string;            // Decision output (next actions, task list)
  act: ChatCompletionMessageParam[]; // Tool calls and responses so far
  
  // For page-out/page-in
  transientMessages: ChatCompletionMessageParam[]; // Full message history for this task
  symbolCacheSnapshot: Map<string, CacheEntry>;    // Symbol cache state
  turnCountSnapshot: number;                         // Current turn counts
  activeToolCalls: ChatCompletionMessageToolCall[];  // In-flight tool calls
  loopCount: number;                                 // Current OODA loop count
  toolLoopCount: number;                             // Current tool round count within this OODA cycle
}

interface TaskCompletionCondition {
  type: 'finish_task_called' | 'narrative_output' | 'trace_satisfied' | 'self_terminating';
  // For finish_task: the task ID that must call finish_task
  requiredTaskId?: string;
}
```

---

## Interrupt Types and Priority

| Priority | Type | Trigger | Preempts |
|----------|------|---------|----------|
| 1 (URGENT) | `user_message` | User sends message via UI/IPC | All |
| 2 (HIGH) | `perception_spike` | Realtime scene change, high-severity alert | 3, 4 |
| 3 (MEDIUM) | `agent_round` | WTA-routed delta batch | 4 |
| 4 (LOW) | `world_delta` / `background_delta` | Monitoring poll, RSS update | Nothing |

---

## OODA Cycle per Task Type

### User Message Task (Priority 1)
1. **Observe:** Capture scene snapshot, extract voice auth, capture user message
2. **Orient:** Run `primeSymbolicContext` (fast model priming, symbolic search, anticipated web search)
3. **Decide:** Fast model predicts tool needs, sets up task list if subtasks identified
4. **Act:** Run tool loop (replaces current `sendMessageAndHandleTools`)
   - Each tool call is tracked
   - `finish_task` tool signals completion
   - Result routed based on task type (user → UI stream)

### Perception Spike Task (Priority 2)
1. **Observe:** Assess spike content (realtime change, alert, monitoring event)
2. **Orient:** Search symbolic store for related context, inject into cache
3. **Decide:** Determine if action needed (update graph, notify user, create subtasks)
4. **Act:** Execute tools to process the spike, call `finish_task`

### Agent Round Task (Priority 3)
1. **Observe:** Batch of deltas routed to this agent
2. **Orient:** Prime relevant symbolic context
3. **Decide:** Determine which deltas need action vs. passive ingestion
4. **Act:** Process deltas, update symbolic graph, call `finish_task`

### Background Delta Task (Priority 4)
1. **Observe:** World deltas from monitoring
2. **Orient:** Lightweight symbol lookup
3. **Decide:** Passive ingestion or graph update
4. **Act:** Minimal tool calls, call `finish_task`

---

## File Changes — New Files

### 1. `src/main/services/interruptQueue.ts` (NEW)
Priority queue for interrupts.

```typescript
class InterruptQueue {
  private queue: Interrupt[] = [];
  
  push(interrupt: Interrupt): void;       // Add with priority
  pop(): Interrupt | null;                 // Get highest priority
  peek(): Interrupt | null;                // View top without removing
  isEmpty(): boolean;
  size(): number;
  clear(): void;
  contains(type: string): boolean;         // Check if same-type pending
}
```

### 2. `src/main/services/taskSystem.ts` (NEW)
Core task management: creation, state, lifecycle.

```typescript
class TaskSystem {
  createTask(type, priority, sessionId, metadata): Task;
  getState(taskId): TaskState | null;
  setState(taskId, state): void;
  completeTask(taskId, result): void;
  getPageOutSnapshot(taskId): TaskState;     // For preemption
  getPageInSnapshot(taskId, snapshot): void;  // Restore after preemption
  getActiveTask(): Task | null;              // Currently running task
  getPendingTasks(): Task[];                 // All pending tasks
  getTasksByPriority(): Map<number, Task[]>; // Grouped by priority
}
```

### 3. `src/main/services/interruptOrchestrator.ts` (NEW)
Main orchestrator: manages the interrupt-driven loop.

```typescript
class InterruptOrchestrator {
  constructor(taskSystem: TaskSystem, interruptQueue: InterruptQueue);
  
  start(): void;           // Begin processing loop
  stop(): void;            // Graceful shutdown
  pushInterrupt(interrupt): void;  // External entry point
  
  // Internal
  processNext(): Promise<void>;    // Pop and process highest priority
  preemptCurrent(reason): void;    // Page out current, page in new
  resumeNext(): Promise<void>;     // Resume after preemption
  runOODACycle(task): AsyncGenerator<...>;  // OODA loop
  routeResult(task, result): void;  // Route based on task type
}
```

### 4. `src/main/services/taskRouting.ts` (NEW)
Routes incoming events to interrupts/tasks.

```typescript
class TaskRouter {
  // Converts external events into interrupt queue entries
  routeUserMessage(message, sessionId): void;
  routePerceptionSpike(spike, sessionId): void;
  routeAgentRound(agentId, deltas): void;
  routeWorldDelta(delta): void;
  routeAlert(alert): void;
}
```

---

## File Changes — Modified Files

### 5. `src/main/services/inferenceService.ts` — Major changes

**a) Replace `sendMessageAndHandleTools` with task-aware tool loop**

Current `sendMessageAndHandleTools` is a flat 15-loop. Replace with:

```typescript
// New: tool loop that tracks task state
async function* runTaskToolLoop(
  task: Task,
  taskState: TaskState,
  chat: ChatSessionState,
  toolExecutor: ToolExecutor,
  traceNeeded: boolean
): AsyncGenerator<StreamChunk> {
  // Each iteration:
  // 1. Check if higher priority interrupt arrived (preemption)
  // 2. Build context window (task-scoped)
  // 3. Stream assistant response
  // 4. Execute tool calls
  // 5. Check for finish_task tool call
  // 6. If finish_task: return result, signal completion
  // 7. If narrative output + trace satisfied: signal self-terminate
  // 8. Update task state (persist transient messages)
  // 9. Loop
}
```

**b) Replace `MAX_TOOL_LOOPS` with task completion conditions**

- Remove `MAX_TOOL_LOOPS = 15` constant
- Each task type has its own completion condition
- `finish_task` tool is the primary completion signal
- Fallback: self-terminating if no subtasks and narrative output present

**c) Add `finish_task` tool to `toolsService.ts`**

**d) Remove `processMessageAsync` as top-level entry point**

- Replace with `orchestrator.pushInterrupt({ type: 'user_message', ... })`
- `processMessageAsync` becomes a thin wrapper that creates a task

### 6. `src/main/services/toolsService.ts` — Add `finish_task` tool

```typescript
// New tool in STATIC_PRIMARY_TOOLS
{
  type: 'function',
  function: {
    name: 'finish_task',
    description: 'Signal that this task is complete. Call with the task_id and optional result payload. The system will route the result and process the next pending interrupt.',
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The ID of the task being completed' },
        result: { 
          type: 'object', 
          description: 'Optional structured result payload. For user_message tasks, this becomes the response to the user. For agent/world tasks, this is stored in task state.' 
        },
        status: { 
          type: 'string', 
          enum: ['completed', 'interrupted', 'failed'],
          description: 'Completion status'
        }
      },
      required: ['task_id']
    }
  }
}
```

**Tool executor case:**
```typescript
case 'finish_task': {
  const taskId = args.task_id;
  const status = args.status || 'completed';
  const result = args.result || null;
  
  await taskSystem.completeTask(taskId, { status, result });
  
  return { 
    status: 'task_complete',
    task_id: taskId,
    next_interrupt_available: interruptQueue.size() > 0
  };
}
```

### 7. `src/main/services/alertTriggerService.ts` — Modify to use task system

**Before:** `onInferenceComplete()` returns alert, caller invokes `processMessageAsync`.

**After:** `onInferenceComplete()` pushes alert as a priority 2 interrupt to the queue.

```typescript
// Remove: onInferenceComplete(), resolveTrigger()
// Replace with:
async function onInferenceComplete(): Promise<void> {
  const alert = getHighestPriorityPendingAlert();
  if (alert) {
    await taskRouter.routeAlert(alert);  // → interrupt queue
  }
}
```

### 8. `src/main/services/agentRunner.ts` — Modify to use task system

**Before:** `executeAgentBatchTurn()` calls `sendMessageAndHandleTools` directly.

**After:** `executeAgentBatchTurn()` pushes an agent_round interrupt.

```typescript
// Remove: executeAgentBatchTurn() direct tool loop
// Replace with:
async function onBatchReady(agentId: string, deltas: MonitoringDelta[]): Promise<void> {
  await taskRouter.routeAgentRound(agentId, deltas);
}
```

### 9. `src/main/services/contextWindowService.ts` — Modify for task-scoped context

**Changes:**
- Context window becomes task-scoped, not session-scoped
- `constructContextWindow(task, taskState)` instead of `constructContextWindow(sessionId)`
- Task state determines which symbols are "mature" vs "new"
- Page-in restores symbol cache snapshot
- Page-out saves symbol cache snapshot

### 10. `src/main/services/monitoringService.ts` — Modify delta emission

**Before:** Emits `monitoring:delta-created` event → `agentRunner` handles.

**After:** Emits → `taskRouter.routeWorldDelta()` → interrupt queue (priority 4).

### 11. `src/main/index.ts` — Wire up orchestrator

**Before:** `INFERENCE_COMPLETED` listener → `alertTriggerService.onInferenceComplete()` → `processMessageAsync()`.

**After:** `INFERENCE_COMPLETED` listener → `interruptOrchestrator.onInferenceComplete()`.

**IPC handler changes:**
- `inference:send` → `taskRouter.routeUserMessage()` → `interruptOrchestrator.pushInterrupt()`
- New IPC: `task:status` → query active/pending tasks
- New IPC: `task:list` → list all tasks for a session

### 12. `src/main/types.ts` — Add new types

```typescript
export type TaskType = 'user_message' | 'perception_spike' | 'agent_round' | 'world_delta' | 'background_delta';
export type TaskPriority = 1 | 2 | 3 | 4;
export type TaskStatus = 'pending' | 'running' | 'completed' | 'preempted' | 'failed';

export interface Task {
  id: string;
  type: TaskType;
  priority: TaskPriority;
  sessionId: string;
  status: TaskStatus;
  state: TaskState;
  completionCondition: TaskCompletionCondition;
  createdAt: number;
  completedAt?: number;
  metadata: Record<string, any>;
}

export interface TaskState {
  observe: string;
  orient: string;
  decide: string;
  act: ChatCompletionMessageParam[];
  transientMessages: ChatCompletionMessageParam[];
  symbolCacheSnapshot: Map<string, CacheEntry>;
  turnCountSnapshot: number;
  activeToolCalls: ChatCompletionMessageToolCall[];
  loopCount: number;
  toolLoopCount: number;
}

export interface TaskCompletionCondition {
  type: 'finish_task_called' | 'narrative_output' | 'trace_satisfied' | 'self_terminating';
  requiredTaskId?: string;
}

export interface Interrupt {
  id: string;
  type: TaskType;
  priority: TaskPriority;
  sessionId: string;
  payload: Record<string, any>;
  createdAt: number;
}
```

### 13. `src/renderer/src/components/TaskView.tsx` (NEW)
UI component for displaying task queue and current task state.

```typescript
// Shows:
// - Active task (with OODA phase indicator)
// - Pending task queue (priority-ordered)
// - Task completion status
// - Tool calls in progress for active task
```

### 14. `src/renderer/src/components/ChatInput.tsx` — Minor update
- Update to work with task-based flow (no change to message sending, just event handling)

---

## Page-Out / Page-In Mechanism

When a higher-priority interrupt arrives:

1. **Detect preemption:** Before each tool loop iteration, check `interruptQueue.size() > 0 && interruptQueue.peek().priority < currentTask.priority`
2. **Page out current task:**
   - Capture `transientMessages` → persist to task state
   - Capture `symbolCacheService` state → snapshot
   - Capture `turnCount` → snapshot
   - Mark task as `preempted`
   - Clear `activeToolCalls` (they become orphaned — their results are in transient messages)
3. **Page in new task:**
   - If it's a new task: fresh start, prime context
   - If it's a resumed task: restore snapshot, re-inject symbol cache, prepend transient messages to context
4. **Resume after preemption:** When preemption resolves, restore preempted task's state and continue from where it left off.

### State Persistence Strategy

| State | Page-Out | Page-In |
|-------|----------|---------|
| Transient messages | Persist to `taskState.transientMessages` | Prepend to context window |
| Symbol cache | Snapshot `sessionCaches` Map | Restore via `batchUpsertSymbols` |
| Turn counts | Snapshot per-symbol turnCount | Restore via `batchUpsertSymbols` with snapshot values |
| In-flight tool calls | Discard (results already in transient) | N/A — new task starts fresh |
| Loop count | Increment and store | Restore `loopCount` |

---

## Context Window Changes

### Before (session-scoped):
```
1. System Prompt
2. Stable Context (domains, identity, defense)
3. Mature Symbols (turnCount >= 2)
4. History Summary
5. Active Alerts
6. Conversation History (sliding window)
7. New Symbols (turnCount < 2)
8. System Metadata
```

### After (task-scoped):
```
1. System Prompt (same)
2. Stable Context (same — session-level, not task-level)
3. Task Symbols (symbols primed by this task's Observe/Orient)
4. History Summary (same)
5. Active Alerts (same)
6. Task Transient Messages (page-in state, replaces conversation history for this task)
7. Task Dynamic Symbols (volatile symbols from this task)
8. System Metadata (includes task ID, OODA phase)
```

**Key change:** The conversation history for the active task is replaced by the task's `transientMessages`. Other tasks' histories are not in the context window (they're paged out).

---

## Background Mode

When the interrupt queue is empty:

1. **Idle state:** System enters background mode
2. **Background delta processing:** Poll monitoring for unprocessed deltas
3. **Priority:** Lowest — can be preempted by any interrupt
4. **Task type:** `background_delta`
5. **Behavior:** Process deltas with minimal tool calls, passive graph updates
6. **Timeout:** Background tasks have a max loop count (e.g., 5) to prevent runaway processing

---

## Completion Conditions per Task Type

| Task Type | Primary Completion | Fallback |
|-----------|-------------------|----------|
| `user_message` | `finish_task` called with result | Narrative output + trace satisfied (max 25 tool rounds) |
| `perception_spike` | `finish_task` called | Self-terminating after graph update |
| `agent_round` | `finish_task` called | All deltas processed, no subtasks |
| `world_delta` | `finish_task` called | Self-terminating |
| `background_delta` | `finish_task` called | Max 5 tool rounds |

---

## Result Routing

When `finish_task` is called:

| Task Type | Routing |
|-----------|---------|
| `user_message` | Stream result to UI via IPC (`task:result` event) |
| `perception_spike` | Store result in task state, notify if critical |
| `agent_round` | Store result, mark deltas as processed |
| `world_delta` | Store result passively |
| `background_delta` | Store result passively |

---

## Phase Breakdown

### Phase 1: Foundation (interrupt queue + task system)
- [ ] Create `interruptQueue.ts` — priority queue implementation
- [ ] Create `taskSystem.ts` — task CRUD, state management
- [ ] Add types to `types.ts` — Task, TaskState, Interrupt, TaskCompletionCondition
- [ ] Unit tests for queue and task system

### Phase 2: Orchestrator + OODA cycle
- [ ] Create `interruptOrchestrator.ts` — main loop, preemption, routing
- [ ] Implement OODA cycle per task type
- [ ] Implement page-out/page-in mechanism
- [ ] Wire `INFERENCE_COMPLETED` listener to orchestrator

### Phase 3: Tool integration
- [ ] Add `finish_task` tool to `toolsService.ts`
- [ ] Modify `createToolExecutor` to integrate with task system
- [ ] Replace `sendMessageAndHandleTools` with task-aware tool loop
- [ ] Replace `MAX_TOOL_LOOPS` with task completion conditions

### Phase 4: Event routing
- [ ] Create `taskRouting.ts` — route events to interrupts
- [ ] Modify `alertTriggerService` — push to queue instead of post-inference trigger
- [ ] Modify `agentRunner` — push agent_round interrupts instead of direct execution
- [ ] Modify `monitoringService` — route deltas through task router
- [ ] Update `index.ts` — wire IPC handlers to orchestrator

### Phase 5: Context window updates
- [ ] Modify `contextWindowService` — task-scoped context construction
- [ ] Update symbol cache snapshot/restore
- [ ] Update partitioning logic for task state

### Phase 6: Renderer updates
- [ ] Create `TaskView.tsx` — task queue display
- [ ] Update event handling in renderer
- [ ] Add IPC handlers for task status queries

---

## Migration Notes

### Breaking Changes
1. `processMessageAsync` is no longer the top-level entry point — replaced by orchestrator
2. `sendMessageAndHandleTools` loop semantics change — task-scoped instead of session-scoped
3. `alertTriggerService.onInferenceComplete()` no longer returns an alert — pushes to queue
4. `agentRunner.executeAgentBatchTurn()` removed — replaced by interrupt push
5. Context window structure changes — task-scoped transient messages

### Non-Breaking
1. `symbolCacheService` API unchanged — only usage patterns change
2. `contextService` unchanged — sessions still exist
3. `domainService` unchanged
4. `toolsService` — only adds `finish_task`, existing tools unchanged
5. IPC handlers for `inference:send` still work — just routed differently internally

### Rollback Strategy
Each phase is independently testable. Phase 1-2 can be tested in isolation with mock inference. Phase 3 is the critical integration point. Each phase can be gated behind a feature flag.

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Preemption state loss | Thorough snapshot/restore testing; persist transient messages to contextService |
| Context window bloat from task state | Enforce token budget per task; truncate oldest transient messages |
| Interrupt queue backlog | Max queue size; drop lowest priority when full |
| Background delta processing starvation | Priority aging; background tasks get boosted after N minutes |
| Tool call orphaning on preemption | Tool results already in transient messages; no data loss |
| Renderer complexity | TaskView is a simple priority queue display; minimal new logic |

---

## Success Criteria

1. **Every piece of work is a task** — user messages, alerts, deltas, agent rounds all flow through the same interrupt queue
2. **No fixed tool round limit** — completion is driven by `finish_task` or task-specific conditions
3. **Preemption works** — high priority interrupt correctly pages out low priority task and restores it
4. **Background mode works** — system processes deltas when idle, responds to interrupts
5. **Single context** — only one context window exists, scoped to the active task
6. **No data loss on preemption** — all task state is captured and restored correctly
