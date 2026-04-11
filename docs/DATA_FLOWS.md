# SignalZero Data Flows

The SignalZero kernel coordinates complex, multi-turn data flows between local hardware, external intelligence streams, and the symbolic store.

## 1. User Message Life Cycle

When you send a message, the kernel executes the following sequence:

1.  **Attachment Resolution:** `inferenceService` scans for `<attachments>` tags. It fetches the full record (base64 pixels + extracted text) from the `attachments` table.
2.  **Context Priming:** The `primeSymbolicContext` function is triggered.
    - **Fast Model Gating:** A 0.8B model analyzes your message to predict which symbols or web searches are needed.
    - **Symbol Retrieval:** Relevant symbols are fetched from the store and pre-cached.
    - **Web Search:** If needed, a grounded search is performed *before* the main model turn.
3.  **Context Window Construction:** `contextWindowService` builds the final prompt.
    - **Compression:** Hides older messages, strips tool JSON, and injects the high-level summary.
    - **Grounding:** Injects the primed symbols and anticipated web results.
4.  **Inference Priority:** The request enters the `InferenceLockManager`. If hardware is free, it acquires the lock.
5.  **Multi-Turn Tool Loop:** The Main Model (e.g., Gemini 2.5 Pro) runs.
    - **Stream:** Thoughts are streamed to the UI in real-time.
    - **Tool Calls:** Model calls `find_symbols`, `upsert_symbols`, `log_trace`, etc.
    - **Looping:** The kernel executes the tools and feeds results back to the model until it generates a narrative response.
6.  **Post-Processing:** The session is auto-named if it's new, and summarization is triggered every 12 rounds.

## 2. World Monitoring & Synthesis

The monitoring pipeline runs continuously in the background:

1.  **Polling:** `monitoringService` executes provider-specific logic (ACLED, GDELT, RSS).
2.  **Itemization:** Raw data is broken into distinct events/articles.
3.  **Summarization:** The **Fast Model** (0.8B) generates a concise bulleted summary for each item.
4.  **Delta Recording:**
    - The summary is saved to SQLite.
    - The event is indexed in LanceDB for future semantic retrieval.
    - A `monitoring:delta-created` event is emitted.

## 3. Autonomous Agent Flow (Neural Gating)

This flow is triggered by the `monitoring:delta-created` event:

1.  **Observer Check:** `AgentRunner` lists all enabled agents with active subscriptions.
2.  **Neural Gating (The Vibe Check):** For each agent, the **0.8B model** performs a tiny inference: *"Does this delta match the agent's subscriptions?"*
3.  **Priority Queue:** If **YES**, the agent is queued for a turn with **Priority 0** (Background).
4.  **Resumed Turn:** When the GPU is free, the agent executes its `Cognitive Protocol` using the same multi-turn loop as a user message, but within its own "Agent: [ID]" context.
5.  **Persistence:** The delta is marked as "processed" in the database to ensure no redundant triggers occur.

## 4. Graph Hygiene (Self-Organization)

Running every 15 minutes:
1.  **Adjacency Mapping:** `TopologyService` loads the entire symbolic graph.
2.  **Component Analysis:** Identifies isolated islands of knowledge.
3.  **Strategy Execution:**
    - **Bridge Lifting:** Evaluates cross-domain links and promotes them to the lattice level.
    - **Canonical Merging:** Finds semantically identical symbols and merges them.
    - **Reflexive Integrity:** Ensures all relational links are properly bidirectional.
