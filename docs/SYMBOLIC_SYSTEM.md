# The SignalZero Symbolic System

At the core of SignalZero is a recursive symbolic language. Knowledge is not stored as raw text, but as a high-density relational graph of **Symbols**.

## 1. Symbol Structure (`SymbolDef`)

Every symbol in the kernel follows a strict schema to ensure machine-readability and deterministic graph traversals.

| Property | Description |
| :--- | :--- |
| **ID** | A unique, uppercase identifier (e.g., `LATTICE-CORE-REASONING`). |
| **Name** | A natural language name for the symbol. |
| **Role** | A concise definition of the symbol's function or essence. |
| **Kind** | The structural category (Pattern, Lattice, Persona, or Data). |
| **Triad** | Optional 3-way grouping identifier for dialectic resonance. |
| **Facets** | Key/Value pairs defining specific attributes or state. |
| **Links** | An array of relationships to other symbols. |

## 2. Symbol Kinds

The kernel uses "Kinds" to define how a symbol interacts with others during reasoning:

- **Lattice:** A high-level organizational structure or category. Lattices "contain" or "exemplify" patterns.
- **Pattern:** A specific instance, mechanism, or behavior. This is the primary unit of reasoning.
- **Persona:** Defines an identity or "cognitive protocol" for an agent or system.
- **Data:** Stores persistent facts, timestamps, or state payloads (e.g., agent memory).

## 3. The Link Taxonomy

Relationships in SignalZero are typed. The `TopologyService` and `InferenceService` use these types to weight reasoning paths.

| Link Type | Reciprocal | Meaning |
| :--- | :--- | :--- |
| **Relates To** | relates_to | General semantic connection. |
| **Depends On** | required_by | Structural or logical dependency. |
| **Part Of** | contains | Mereological hierarchy (Composition). |
| **Instance Of** | exemplifies | Categorical hierarchy (Classification). |
| **Informs** | informed_by | Data or signal flow between systems. |
| **Constrains** | constrained_by | Behavioral or policy enforcement. |

## 4. Automatic Reciprocation

The `domainService` implements **Relational Symmetry**. When an agent creates a link from `A -> B` with type `depends_on`, the kernel automatically instantiates the reciprocal link `B -> A` with type `required_by`. This ensures the graph is always traversable from any node.

## 5. Symbolic Invariants

The kernel enforces strict invariants during symbol creation:
- **No Orphans:** Every symbol must eventually be bridged to a Lattice or the Mainland.
- **Deterministic IDs:** IDs are sanitized to uppercase with hyphens to maintain a uniform address space.
- **Provenance:** Symbols often include a `metadata.source` to track the origin (e.g., a specific delta or URL).
