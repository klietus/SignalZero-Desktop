# Graph Hygiene & Topology Analysis

SignalZero is a self-organizing knowledge system. The `TopologyService` runs in the background to ensure the Symbolic Store remains a coherent, relational "Mainland" rather than a fragmented collection of data "Islands."

## 1. The Analysis Loop

The topology engine executes every 15 minutes, performing a multi-strategy pass across all active symbolic domains.

### Step 1: Component Detection
Using an undirected adjacency map, the kernel identifies "Connected Components." This tells the system which groups of symbols are isolated from each other and from the core "Mainland" (the component containing `USER-RECURSIVE-CORE`).

### Step 2: Bridge Isolated Subgraphs
To prevent knowledge silos, the system automatically bridges "Islands" to the "Mainland."
- **Centroid Selection:** The system identifies the most representative symbol in an island (preferring those with "CORE" in their ID).
- **Relational Anchoring:** It creates a `relates_to` link between the island centroid and the mainland centroid.

## 2. Intelligence Automation

These strategies use AI models to actively reason about the relationships between symbols.

### Semantic Intelligence (Vector-Based)
- **Auto-Compress:** Scans for semantically redundant symbols using vector similarity. If two symbols represent the same concept, they are merged into a canonical form.
- **Auto-Link:** Identifies missing relationships by comparing symbol embeddings. If two symbols are highly similar but unlinked, the kernel proposes a relationship.

### Triadic Resonance (Emoji-Based)
- **Auto-Compress:** Merges symbols that share the same **Semiotic Triad** (3-emoji concept anchor), assuming they occupy the same conceptual space.
- **Auto-Link:** Creates links between symbols that share overlapping triad components, enabling structural resonance across different domains.

## 3. Analysis & Healing Strategies

These are structural background tasks that maintain the graph's health and connectivity.

| Strategy | Function |
| :--- | :--- |
| **Canonical Link Refactoring** | Consolidates various specific link types into their most stable canonical forms to reduce taxonomy drift. |
| **Reflexive Link Synthesis** | Enforces symmetry. If A links to B, this ensures B has the appropriate reciprocal link back to A (e.g., `part_of` ↔ `contains`). |
| **Island Bridging & Orphan Healing** | Detects disconnected subgraphs and orphaned symbols, creating bridge links to the core "Mainland" to ensure global traversability. |
| **Domain Lattice Docking** | Anchors floating, unlinked patterns into their most appropriate domain lattices based on metadata and similarity. |
| **Bridge Lifting** | Elevates cross-domain links from specific patterns to high-level lattices when the relationship is a structural property rather than a local detail. |
| **Link Promotion** | Upgrades generic `relates_to` links to stronger semantic types (like `depends_on` or `exemplifies`) when high confidence is detected. |
| **Dead Link Cleanup** | Performs garbage collection by removing links that point to IDs that no longer exist in the symbolic store. |

## 4. The 3-Hop Constraint

To maintain high relational signal and prevent "Graph Bloat," the **Semantic** and **Triadic** auto-linking strategies use a distance check:
- **Constraint:** A new link is only proposed if the two symbols are currently separated by **at least 3 hops**.
- **Rationale:** If symbols are already reachable in 1 or 2 hops, a new link adds no new structural information and only increases entropy.

## 4. Visibility & Tracing

Every self-organization action is:
1.  **Logged:** Recorded in the system logs with categorical metadata.
2.  **Broadcast:** Emitted to the UI event bus, allowing you to see the graph evolve in real-time.
3.  **Audited:** Stored in the SQLite database, ensuring every link mutation can be traced back to a specific hygiene run.
