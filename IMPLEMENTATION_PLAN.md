# Agentic Branch — Implementation Plan

> Step-by-step implementation plan for agentic branch changes.
> Branch: `agentic` (from `main`)

---

## Overview

9 targeted changes to route Gemini through its OpenAI-compatible endpoint (keeping settings), while adding a task list system, stricter turn management, and cleaner symbolic binding.

---

## Phase 1: Gemini → OpenAI-Compatible Endpoint (2-3 days)

### 1.1 Route Gemini Through OpenAI SDK

**File: `src/main/services/inferenceService.ts`**

- [ ] **Keep** `geminiSettings` — it stores the OpenAI-compatible endpoint config (API key, base URL, model)
- [ ] Remove import: `import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";`
- [ ] Remove `getGeminiClient()` function (line 237-239)
- [ ] Remove `cleanGeminiSchema()` function (line 242-261)
- [ ] Remove `toGeminiTools()` function (line 263-275)
- [ ] Remove entire Gemini streaming branch from `_streamAssistantResponseInternal()` (lines 425-745)
- [ ] **Replace** the Gemini branch with OpenAI-compatible call:
  ```typescript
  // Instead of: const response = geminiClient.chat.completions.create(...)
  // Use: const openaiClient = new OpenAI({ apiKey: geminiSettings.apiKey, baseURL: geminiSettings.baseUrl })
  // Then: const response = openaiClient.chat.completions.create(...)
  ```
- [ ] Simplify `unifyFinishReason()` — remove Gemini-specific enum cases, keep only OpenAI finish_reason handling
- [ ] Replace `(any).finishReason = unifyFinishReason(...)` with direct `finish_reason` checks
- [ ] In `callFastInference()`: change Gemini provider branch to use OpenAI SDK:
  ```typescript
  // Instead of: const geminiClient = getGeminiClient(); ... geminiClient.chat.completions.create(...)
  // Use: const openaiClient = new OpenAI({ apiKey: geminiSettings.apiKey, baseURL: geminiSettings.baseUrl, model: geminiSettings.model });
  // Then: const response = openaiClient.chat.completions.create(...)
  ```
- [ ] In `sendMessageAndHandleTools()`: remove Gemini-specific termination check (lines 951-964)

**File: `src/main/services/inferenceService.ts` — Finish Reason Handling**

- [ ] Simplify finish reason handling in OpenAI stream:
  ```typescript
  // Replace: (assistantMessage as any).finishReason = unifyFinishReason(...)
  // With: (assistantMessage as any).finishReason = finishReason === 'tool_calls' ? 'tool-calls' : 'stop';
  ```
- [ ] Update `FinishReason` enum — remove Gemini-specific values (`SAFETY` can stay for backward compat)

**Package.json**

- [ ] Remove `@google/generative-ai` from dependencies

### 1.2 Keep Gemini Provider Settings

**File: `src/main/services/settingsService.ts`**

- [ ] **Keep** `gemini` in provider options/validation — it's still a valid provider (just uses OpenAI SDK underneath)
- [ ] No changes needed to gemini settings structure

---

## Phase 2: Task List System (2-3 days)

### 2.1 Define Task List Types

**File: `src/main/types.ts`**

- [ ] Add new types:
  ```typescript
  export interface Task {
    id: string;
    title: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    createdAt: string;
    completedAt?: string;
    parentId?: string;
    subtaskIds: string[];
    toolCalls: string[];  // tool names used for this task
    result?: string;
  }

  export interface TaskList {
    sessionId: string;
    tasks: Task[];
    createdAt: string;
    updatedAt: string;
  }
  ```

### 2.2 Implement TaskListService

**File: `src/main/services/taskListService.ts` (NEW)**

- [ ] Create `TaskListService` class:
  ```typescript
  class TaskListService {
    private taskLists = new Map<string, TaskList>();

    createTaskList(sessionId: string): TaskList;
    addTask(sessionId: string, title: string, description?: string, parentId?: string): Task;
    completeTask(sessionId: string, taskId: string, result?: string): void;
    failTask(sessionId: string, taskId: string): void;
    getTaskList(sessionId: string): TaskList | null;
    getPendingTasks(sessionId: string): Task[];
    getInProgressTasks(sessionId: string): Task[];
    getCompletedTasks(sessionId: string): Task[];
    updateTaskStatus(sessionId: string, taskId: string, status: Task['status']): void;
    recordToolCall(sessionId: string, taskId: string, toolName: string): void;
    generateProgressReport(sessionId: string): string;
    pruneOldTaskLists(olderThanDays: number): void;
  }
  ```
- [ ] Auto-create task list when context session is created
- [ ] Auto-complete task when `log_trace` is called with related task ID
- [ ] Generate progress report for injection into context window system metadata block

### 2.3 Inject Task List into Context Window (System Metadata Block)

**File: `src/main/services/contextWindowService.ts`**

- [ ] In `constructContextWindow()`: inject task list into the **system metadata block at the end** of the context window:
  ```typescript
  // At the end of the system metadata block (after [SYSTEM_STATE]):
  const taskList = taskListService.getTaskList(contextSessionId);
  if (taskList) {
    const report = taskListService.generateProgressReport(contextSessionId);
    if (report) {
      // Inject into the system metadata block — this block is appended at the end
      // of the context window, so task list is always fresh
      messages.push({
        role: 'system',
        content: `[TASK_LIST]\n${report}`
      });
    }
  }
  ```
- [ ] No agent/runner code needed — task list is part of session object creation and context window construction only

### 2.4 Update Activation Prompt for Tasks

**File: `src/main/symbolic_system/activation_prompt.ts`**

- [ ] Add task list usage section:
  ```
  ⚠️ CRITICAL: TASK MANAGEMENT PROTOCOL
  - At the start of any complex operation, create a task list using the task_system tool.
  - Break complex operations into discrete, verifiable subtasks.
  - Update task status as you work (pending → in_progress → completed/failed).
  - Reference task IDs in your log_trace calls for auditability.
  - On turn completion, verify all tasks are resolved or explicitly note pending work.
  ```

### 2.5 Add `create_domain` Tool (Wired to DomainInferenceService)

**File: `src/main/services/toolsService.ts`**

- [ ] Add `create_domain` tool definition to the TOOLS array (after `list_domains`):
  ```typescript
  {
    type: 'function',
    function: {
      name: 'create_domain',
      description: 'Create a new symbolic domain with AI-inferred invariants. Use when a concept does not fit any existing domain.',
      parameters: {
        type: 'object',
        properties: {
          domain_id: { type: 'string', description: 'Unique slug identifier for the new domain.' },
          name: { type: 'string', description: 'Display name for the domain.' },
          description: { type: 'string', description: 'Detailed description of the domain scope.' }
        },
        required: ['domain_id', 'name', 'description']
      }
    }
  }
  ```

- [ ] Add `create_domain` execution case in the tool executor switch (after `list_domains` case):
  ```typescript
  case 'create_domain': {
    const { domainId, name, description } = args;
    const result = await domainInferenceService.createDomainWithInference(domainId, description, name);
    loggerService.catInfo(LogCategory.TOOL, `create_domain: Created '${domainId}' with ${result.inferred_from.length} contextual references.`, { domainId, inferred_from: result.inferred_from });
    return {
      status: 'success',
      domain_id: domainId,
      invariants: result.domain.invariants,
      inferred_from: result.inferred_from,
      reasoning: result.reasoning,
    };
  }
  ```

- [ ] Import `domainInferenceService` at top of `toolsService.ts`:
  ```typescript
  import { domainInferenceService } from './domainInferenceService.js';
  ```

---

## Phase 3: Turn Ending Logic Rework (2-3 days)

### 3.1 Remove Tool Call Limit

**File: `src/main/services/inferenceService.ts`**

- [ ] **Do not add** `MAX_TOOL_CALLS_PER_TURN` — let the turn ending logic handle termination naturally
- [ ] The agent should be allowed to run as long as it produces tool calls and the system can handle it
- [ ] Turn ending logic (Phase 3.2) handles completion via narrative + trace signals, not arbitrary limits

### 3.2 Rework Turn Ending Conditions

**File: `src/main/services/inferenceService.ts`**

Current turn ending logic (lines 1150-1151):
```typescript
const assistantDoesNotNeedToolResponse = !currentToolNames.has('find_symbols') && !currentToolNames.has('load_symbols') && !currentToolNames.has('web_search');
const isEndingTurn = (!yieldedToolCalls || yieldedToolCalls.length === 0) || (assistantDoesNotNeedToolResponse && hasNarrativeOutput);
```

- [ ] Simplify to:
  ```typescript
  const isEndingTurn = this.shouldEndTurn(yieldedToolCalls, hasNarrativeOutput, hasLoggedTrace, traceNeeded);
  ```
- [ ] Implement `shouldEndTurn()` method:
  ```typescript
  private shouldEndTurn(
    toolCalls: ChatCompletionMessageToolCall[] | undefined,
    hasNarrative: boolean,
    hasTrace: boolean,
    needsTrace: boolean
  ): boolean {
    // No tool calls = always end
    if (!toolCalls || toolCalls.length === 0) return true;

    // Tool calls + narrative = end (synthesis phase)
    if (hasNarrative) return true;

    // Has trace = end (symbolic binding complete)
    if (hasTrace) return true;

    // Needs trace but no trace yet = continue
    if (needsTrace && !hasTrace) return false;

    // All tool calls were log_trace only = end
    if (toolCalls.every(tc => tc.function.name === 'log_trace')) return true;

    // Tools that need responses = continue
    const needsResponse = ['find_symbols', 'load_symbols', 'web_search'];
    return !toolCalls.some(tc => needsResponse.includes(tc.function.name));
  }
  ```

### 3.3 Simplify Narrative Recovery Protocol

**File: `src/main/services/inferenceService.ts`**

- [ ] Remove the complex `auditCheckPrompt` LLM call (lines 1191-1224)
- [ ] Replace with heuristic-based check (tighter regex to reduce false positives):
  ```typescript
  const isAuditApology = textAccumulatedInTurn.match(/(?:apologiz|sorry\s+(i|you|about|for)|forgot\s+to\s+call|mistake\s+in\s+my|oversight)/i);
  if (lastTurnWasAuditFailure && isEndingTurn && isAuditApology) {
    // Force one more loop without LLM call
    transientMessages.push(nextAssistant!);
    transientMessages.push(...toolResponses);
    transientMessages.push({
      role: "user",
      content: "[SYSTEM RECOVERY] Execute the required tools and provide the final synthesis."
    });
    loops++;
    continue;
  }
  ```

---

## Phase 4: Symbolic Binding Updates (1-2 days)

### 4.1 Update Activation Prompt for Symbolic Binding

**File: `src/main/symbolic_system/activation_prompt.ts`**

- [ ] Update SYMBOLIC_TRACE_STRUCTURE section:
  - Keep the schema but add `task_id` field to trace schema:
    ```typescript
    properties: {
      // ... existing fields
      task_id: { type: 'string', description: 'Optional: if this trace is associated with a specific task' }
    }
    ```
- [ ] Add to trace fidelity protocol:
  ```
  ⚠️ CRITICAL: When creating traces for task-related work, include the task_id in the trace to link symbolic execution to task progress.
  ```

### 4.2 Update Context Window Service for Symbolic Binding

**File: `src/main/services/contextWindowService.ts`**

- [ ] In `buildStableContext()`: ensure predicate-based preloads still work (no Gemini-specific code)
- [ ] In `buildDynamicContext()`: same — verify no Gemini dependencies
- [ ] The `formatSymbols()` method: keep as-is (no Gemini-specific code)

---

## Phase 5: Agent Runner Updates (1-2 days)

### 5.1 Update Agent Runner for Task List

**File: `src/main/services/agentRunner.ts`**

- [ ] Import `taskListService`:
  ```typescript
  import { taskListService } from './taskListService.js';
  ```
- [ ] In `executeAgentBatchTurn()`: create initial task list:
  ```typescript
  const taskList = taskListService.createTaskList(session.id);
  const task = taskListService.addTask(session.id, 'Process world deltas', `Analyze ${deltas.length} incoming events`);
  taskListService.addTask(session.id, 'Update symbolic state', 'Sync internal state with new information', task.id);
  taskListService.addTask(session.id, 'Take action if needed', 'Execute appropriate tools', task.id);
  ```
- [ ] **No task progress injection needed** — handled automatically by `contextWindowService` as part of system metadata block

### 5.2 Update Agent Routing Prompt

**File: `src/main/services/agentRunner.ts`**

- [ ] Update WTA (Winner Takes All) prompt to be more concise:
  ```typescript
  const prompt = `Route this event to the best agent.

  EVENT: ${String(delta.content).slice(0, 500)}

  AGENTS:
  ${JSON.stringify(agentMetadata, null, 2)}

  Return JSON: { "winnerId": "agent_id" }`;
  ```

---

## Phase 6: Sample Project Updates (0.5-1 day)

### 6.1 Update Sample Project Activation Prompts

**Directory: `sample_project/`**

- [ ] Update `sample_project/domains/` metadata.json — remove any Gemini-specific references
- [ ] Update `sample_project/` activation prompts to include task management section
- [ ] Ensure all symbol schemas match the updated SYMBOLIC_TRACE_STRUCTURE
- [ ] Remove any Gemini-specific tool definitions

---

## Phase 7: Integration & Testing (1-2 days)

### 7.1 Integration Steps

- [ ] Run `npm install` to remove `@google/generative-ai`
- [ ] Run `tsc --noEmit` to verify no type errors
- [ ] Run existing test suite to verify no regressions
- [ ] Test OpenAI provider (if configured)
- [ ] Test local provider (lm-studio)
- [ ] Test kimi2 provider (if configured)

### 7.2 Manual Testing Checklist

- [ ] User chat: send message, verify response with tool calls
- [ ] User chat: send message, verify response without tool calls
- [ ] Agent batch: verify task list creation
- [ ] Agent batch: verify delta routing
- [ ] Symbolic trace: verify trace includes task_id
- [ ] Context window: verify task list section appears
- [ ] Turn ending: verify tool call limit enforcement
- [ ] Turn ending: verify narrative recovery works

---

## Implementation Status

| Phase | Status | Files |
|-------|--------|-------|
| 1. Gemini → OpenAI Endpoint | ✅ Complete | `inferenceService.ts`, `package.json` |
| 2. Task List System | ✅ Complete | `types.ts` (new), `taskListService.ts` (new), `contextWindowService.ts`, `activation_prompt.ts` |
| 2.5. Create Domain Tool | ✅ Complete | `toolsService.ts` |
| 3. Turn Ending Logic | ✅ Complete | `inferenceService.ts` |
| 4. Symbolic Binding | ✅ Complete | `activation_prompt.ts`, `contextWindowService.ts` |
| 5. Agent Runner | ✅ Complete | `agentRunner.ts` |
| 6. Sample Project | ✅ Complete | `sample_project/` |
| 7. Integration & Testing | ✅ Complete | `taskListIntegration.test.ts`, `agentRunnerTaskAwareness.test.ts` |

---

## Implementation Order

| Priority | Phase | Duration | Key Deliverable |
|----------|-------|----------|-----------------|
| 1 | Phase 1: Gemini → OpenAI Endpoint | 2-3 days ✅ | Gemini via OpenAI SDK, no `@google/generative-ai` dep |
| 2 | Phase 2: Task List | 2-3 days ✅ | Task management system |
| 2.5 | Phase 2.5: Create Domain Tool | 0.5 day ✅ | `create_domain` tool wired to `domainInferenceService` |
| 3 | Phase 3: Turn Ending | 2-3 days ✅ | Tool call limit, simplified turn logic |
| 4 | Phase 4: Symbolic Binding | 1-2 days ✅ | Updated traces, context window |
| 5 | Phase 5: Agent Runner | 1-2 day ✅ | Task-aware agent execution |
| 6 | Phase 6: Sample Project | 0.5-1 day ✅ | Updated sample data |
| 7 | Phase 7: Testing | 1-2 days ✅ | Verification (23 tests, all passing) |

**Total estimated time: 9-16 days — COMPLETED**

---

## Key Decisions

1. **Gemini via OpenAI SDK** — keep geminiSettings, remove `@google/generative-ai`, use OpenAI client with Gemini's baseURL
2. **Task list as in-memory service** — no persistence needed, tied to session lifecycle
3. **Tool call limit per turn** — prevents runaway tool loops, forces synthesis
4. **Heuristic over LLM for recovery** — replace audit narrative check with regex
5. **Task_id in traces** — links symbolic execution to task progress
6. **Progress report in context** — inject task state into system prompt

---

*Plan: 2026-06-09*
*Branch: agentic*
*Author: klietus*
