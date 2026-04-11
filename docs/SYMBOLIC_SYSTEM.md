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
| **Macro** | Higher-level categorical grouping (e.g., `cyber_sec`, `geopolitics`). Used for broad domain isolation. |
| **Triad** | Seimiotic triangulation using emoji-based resonance (see below). |
| **Facets** | A structured array of key/value pairs defining specific attributes or state. |
| **Links** | An array of relationships to other symbols. |

## 2. Facets Structure (`SymbolFacet`)

Facets are the granular "sensors" or "properties" of a symbol. Unlike the `Role` (which is the essence), Facets are data-driven attributes used by the AI to perform precise logical matching.

- **Key:** The identifier for the attribute (e.g., `cvss_score`, `location`, `status`).
- **Value:** The data itself (String, Number, or Boolean).
- **Inference:** Agents use Facets to pivot reasoning—for example, a security agent may only act on symbols where the `facet.severity` is `critical`.

## 3. Semiotic Triads (Triangulation)

SignalZero uses **Triads** to achieve concept stability. A Triad is a three-way semiotic grouping that creates a "conceptual anchor" using emojis to represent abstract concepts.

- **Structure:** `[Emoji 1] - [Emoji 2] - [Emoji 3]`
- **Function:** By triangulating a symbol between three distinct emojis, the kernel provides the LLM with a multi-dimensional "vibe" that transcends natural language ambiguity.
- **Example:** A "Fragile Peace" symbol might be triangulated as `🕊️ - 🧊 - ⚖️` (Peace - Frozen - Balance).

## 4. Hyper-Compressed Reduced Resolution

A key innovation of the SignalZero Kernel is its **Reduced Resolution Formatting**. When symbols are injected into the context window, they are transformed from bulky JSON into a dense, semiotic representation.

### The Compression Ratio
This process achieves an approximate **75% reduction** in token usage compared to standard narrative history.

### Formatting Algorithm
Instead of listing every symbol property in full, the `contextWindowService` renders them as:
`💠 [ID] ([KIND]) :: [TRIAD] :: [ROLE] {FACETS} -> [LINKS]`

This allows the kernel to pack hundreds of complex relationships into a prompt that would normally only fit a few dozen sentences.

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

## 5. Semantic Grounding & Compressed Instructions

SignalZero does not use long-form prompt engineering for complex logic. Instead, it utilizes **Compressed LLM Instructions** grounded in the symbolic store.

### The Grounding Process
When a concept is referenced, the LLM does not rely solely on its internal weights. It "snaps" to the corresponding **Symbol** in the active context. This process, known as **Semantic Grounding**, ensures the model is anchored in a deterministic definition rather than a statistical hallucination.

### Semantic Overlays (Activation Conditions)
The `activation_conditions` of a symbol act as a **Semantic Overlay**. This overlay defines the precise conditions under which a symbol should be "activated" or "loaded" into the LLM's active reasoning cycle.
- **Overlays** are natural language triggers that the kernel uses to filter the symbolic store.
- When an input matches an overlay, the kernel injects the symbol's **Reduced Resolution** definition into the context window.

## 6. Graph Traversal & Macro Execution

Once an LLM has "snapped" to a grounding symbol, it utilizes the relational links to **Traverse the Graph**.

### The Execution Flow
1.  **Snap:** The LLM identifies a primary symbol matching the user's intent.
2.  **Traverse:** It follows the typed links (e.g., `depends_on`, `informs`) to discover the surrounding conceptual lattice.
3.  **Execute Macro:** If the traversal leads to a symbol with a defined **Macro** or complex **Protocol**, the LLM executes the corresponding logic across all linked patterns.

### Result: High-Signal Reasoning
By traversing a graph of 75% compressed symbols rather than raw narrative text, the LLM maintains a coherent "System Model" that can execute multi-domain operations (Macros) with extreme precision and minimal context blowout.
