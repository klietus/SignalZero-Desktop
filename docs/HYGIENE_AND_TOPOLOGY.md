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

## 2. Hygiene Strategies

### Cross-Domain Bridge Lifting
When a specific **Pattern** in one domain links to a symbol in another, the kernel uses AI to evaluate if this is a high-level structural dependency.
- **Action:** If the relationship is generalizable, the kernel "lifts" the link from the specific Pattern to its parent **Lattice**.
- **Efficiency:** The original specific link is deleted, reducing graph noise and promoting higher-level semantic understanding.

### Canonical Merging
The kernel continuously scans for semantic redundancy.
- **Vector Matching:** It compares the embeddings of all symbols within a domain.
- **AI Synthesis:** If two symbols are semantically identical, the kernel merges them into a single "Canonical" symbol, re-mapping all existing links to the new ID.

### Reflexive Integrity
To ensure the graph is fully searchable and traversable, the kernel enforces **Bidirectional Reciprocation**.
- If `A` is linked to `B`, the kernel ensures `B` has the corresponding reciprocal link back to `A` (e.g., `depends_on` <-> `required_by`).

## 3. The 3-Hop Constraint

To maintain high relational signal and prevent "Graph Bloat," the **Semantic** and **Triadic** auto-linking strategies use a distance check:
- **Constraint:** A new link is only proposed if the two symbols are currently separated by **at least 3 hops**.
- **Rationale:** If symbols are already reachable in 1 or 2 hops, a new link adds no new structural information and only increases entropy.

## 4. Visibility & Tracing

Every self-organization action is:
1.  **Logged:** Recorded in the system logs with categorical metadata.
2.  **Broadcast:** Emitted to the UI event bus, allowing you to see the graph evolve in real-time.
3.  **Audited:** Stored in the SQLite database, ensuring every link mutation can be traced back to a specific hygiene run.
