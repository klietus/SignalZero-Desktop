# Autonomous Agents & Neural Gating

SignalZero Desktop transforms from a simple chat interface into a continuous world-modeling system through its event-driven agent architecture.

## 1. The Agent Runner (`AgentRunner`)

The `AgentRunner` is a persistent background service that manages the lifecycle of autonomous reasoning. It acts as an observer of the world-monitoring stream, waiting for "Deltas" (significant changes) to occur.

### The Catch-up Mechanism
Upon application startup, the runner performs a **Catch-up Cycle**. It identifies any World Deltas that were recorded while the app was closed and processes them in batches of 5 to prevent initial hardware overload.

## 2. Neural Gating (The 0.8B Vibe Check)

To maintain high performance on local hardware (like the M4 Mac), SignalZero uses a multi-layered gating strategy to prevent "Inference Bloat":

1.  **Subscription Filter:** Agents only wake up for deltas matching their configured keywords or trigger phrases.
2.  **Fast Model Validation:** When a potential match is found, the system sends a tiny request to the **Fast Model** (configured as 0.8B or similar).
3.  **The Question:** *"Given these subscriptions, does this specific delta warrant an autonomous reasoning turn?"*
4.  **Decision:** If the 0.8B model responds **YES**, the system proceeds to trigger the heavy reasoning model. If **NO**, the event is discarded with zero impact on the main GPU budget.

## 3. The Inference Priority Lock

Autonomous turns are executed with **Priority 0 (Background)**. This means:
- If you are currently chatting with the AI, the agent turn is queued.
- The heavy model cores are reserved for your immediate interactions first.
- The moment your chat inference completes, the runner acquires the lock and starts the agent turn.

## 4. Persistent State & Contexts

### Processed Delta Tracking
Every delta processed by an agent is recorded in the `agent_processed_deltas` table. This ensures that even if an agent turn takes a long time, the system will never re-trigger the same agent for the same event.

### Dedicated Agent Contexts
Each agent operates within its own identifiable conversation context (e.g., `Agent: SYMBOLIC-CARTOGRAPHER`). 
- **Visibility:** These contexts appear in your conversation sidebar.
- **Transparency:** You can select an agent's context to watch its thoughts, tool calls, and symbolic updates in real-time.
- **Persistence:** If an agent's context is archived or deleted, the runner automatically instantiates a fresh one for the next turn.

## 5. Cognitive Protocols (Agent Prompts)

Agents use a **Composite System Prompt**:
1.  **Project Protocol:** The core `ACTIVATION_PROMPT` containing global reasoning invariants and tool-use guidelines.
2.  **Agent Protocol:** The specific mission-specific instructions defined in the Agent Orchestrator.

This combination ensures that while an agent has a specialized mission (like "Map Geopolitical Shifts"), it always retains its core identity as a SignalZero symbolic engine.
