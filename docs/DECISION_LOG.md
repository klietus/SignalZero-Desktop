# SignalZero Architectural Decision Log

This log tracks the critical technical pivots and architectural choices made during the development of the SignalZero Kernel.

## 2025-2026: The Core Pivots

### 1. Transition to Local-First Hardware Scaling
- **Decision:** Replace Redis and ChromaDB with synchronous SQLite (`better-sqlite3`) and local LanceDB.
- **Context:** The original server-based architecture added unnecessary async overhead and maintenance complexity for a single-user system.
- **Logic:** Synchronous SQLite simplifies local state management, while LanceDB enables high-performance vector search directly on the filesystem without a sidecar process.

### 2. Implementation of "Neural Gating"
- **Decision:** Inserting a 0.8B parameter model as a mandatory "vibe check" for agents.
- **Context:** 24/7 autonomy on local hardware risked "GPU starvation," making the machine unusable for active chat.
- **Logic:** A tiny model acts as a biological filter (thalamus), validating deltas before waking heavy reasoning models (122B+).

### 3. "Reduced Resolution" Symbolic Language
- **Decision:** Shift from raw JSON history to a compressed semiotic shorthand: `💠 ID :: TRIAD :: ROLE {FACETS}`.
- **Context:** Standard LLM contexts suffer from "context debt" and noise.
- **Logic:** Achieving a 75% reduction in token usage by forcing the model to reason over a dense "map" of the graph rather than an exhaustive data dump.

### 4. Semantic Grounding & Lazy Loading
- **Decision:** Using Semantic Overlays (activation conditions) and descriptive, human-readable IDs.
- **Context:** RAG retrieval often misses nuances or provides too much irrelevant context.
- **Logic:** Descriptive IDs act as "Semantic Signposts," allowing the LLM to intelligently select which links to follow (Lazy Loading) based on the ID's signal.

### 5. Multi-Model Priority Locking
- **Decision:** Implement an `InferenceLockManager` with priority levels (User: 1, Agent: 0).
- **Context:** Hardware contention between user interaction and background autonomy.
- **Logic:** Ensures the user always receives immediate GPU priority while agents utilize "background cycles" for world-modeling.

### 6. Multimodal Sensor Fusion
- **Decision:** Ingesting both AI-generated grounding descriptions and raw base64 pixels.
- **Context:** Description-only vision lacks empirical depth; pixel-only vision lacks symbolic context.
- **Logic:** Provided the AI with both the high-level symbolic bridge and the raw sensory data for direct verification.

### 7. Relational Symmetry & Automatic Reciprocation
- **Decision:** Enforce bidirectional link creation in the `domainService`.
- **Context:** Unidirectional links created "dead-end" reasoning paths in the graph.
- **Logic:** Every link (e.g., `A part_of B`) automatically triggers its inverse (`B contains A`), ensuring the graph is fully traversable.

---
*Entries below are reconstructed from the SignalZero-LocalNode legacy analysis.*

## 2024-2025: The Server-Era Foundations

### 8. Command-Pattern Database Abstraction
- **Decision:** Use a `request(['CMD', ...args])` pattern for database interactions.
- **Logic:** Decoupled core services from the specific database drivers (Redis at the time). This abstraction layer proved critical when pivoting the entire kernel from Redis to SQLite, as the high-level service logic remained largely unchanged.

### 9. Hierarchical Domain Isolation (H-JEPA Influence)
- **Decision:** Strict separation between Global Shared Domains (`root`, `cyber_sec`) and User-Specific Domains (`user`, `state`).
- **Logic:** Influenced by Hierarchical Joint-Embedding Predictive Architecture (H-JEPA) theories. Global domains act as the "Shared World Model" (long-term, collective intelligence), while User domains act as "Episodic/Private Memory" (short-term, individual experience).

### 10. Semiotic Machine Framing
- **Decision:** Defining the system as a "Semiotic Machine" manipulating signs rather than just a "Chatbot."
- **Logic:** Reconceptualized AI through structuralist linguistic theory. This led to the creation of the **Symbolic Triad** (Data structure, Visual representation, Semantic logic), forcing every system update to respect the relationship between the signifier (ID) and the signified (Role/Facets).

### 11. Latent Factor Link Prediction (PRD Stage)
- **Decision:** Proposing a Tensor Network (TN) approach using CP Decomposition for link discovery.
- **Logic:** Recognizing that LLM inference is too expensive for global graph maintenance. Low-rank approximations allowed the kernel to "predict" missing links by analyzing the mathematical topology of the adjacency tensor $(\mathcal{X})$.

### 12. "Zero-Infrastructure" Testing Strategy
- **Decision:** Building comprehensive in-memory mocks for Redis and Vector stores.
- **Logic:** Realized that development speed is bound by infrastructure overhead. By ensuring the entire kernel could boot and pass 100+ tests without a single external database running, the team achieved an extremely tight iteration loop.

### 13. Rich-Text Symbolic Indexing
- **Decision:** Indexing symbols using a synthesized "Rich Text" document rather than just names or roles.
- **Logic:** Recognized that semantic retrieval needs high-dimensional surface area. By concatenating the ID, Triad, Domain, Role, and even JSON facets into a single indexable string, the kernel ensures that specific technical details (like CVE numbers or specific facet values) are searchable even if they aren't part of the primary symbol label.

### 14. Use-Case Driven Lattice Development
- **Decision:** Architecting high-level Lattices based on "Wicked Problem" archetypes (e.g., Ethical Triangulation, Ecological Cascade Risk).
- **Logic:** Recognized that raw LLM reasoning often collapses under the weight of competing value systems (e.g., Utilitarianism vs. Deontology). By providing pre-structured Symbolic Lattices, the kernel forces the model to perform "Structured Ethical Synthesis" rather than simple narrative generation.
