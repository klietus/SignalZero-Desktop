# SignalZero Desktop

SignalZero Recursive Symbolic Kernel - Desktop Edition.

## Demo

[![SignalZero Desktop Demo](https://img.youtube.com/vi/Ys6TIy5-0Gs/maxresdefault.jpg)](https://youtu.be/Ys6TIy5-0Gs)

*Click the image above to watch the demo on YouTube.*

## Overview

SignalZero Desktop is a sophisticated recursive symbolic reasoning engine built as a desktop application using Electron, Vite, and React. It provides a robust environment for managing symbolic contexts, executing tool-based reasoning, and visualizing complex information traces.

## Key Features

- **Recursive Symbolic Reasoning:** Advanced inference engine with multi-step tool integration and trace-based reasoning.
- **Autonomous Event-Driven Agents:** Specialized agents (like the *Symbolic Cartographer*) that react to world events in real-time. Supports persistent delta tracking, keyword subscriptions, and automatic state resume.
- **Neural Gating & Resource Awareness:** High-performance resource management for local hardware. Uses a tiny **0.8B model "Vibe Check"** to gate expensive inference tasks and a **Priority Inference Lock** to ensure smooth UI interaction while agents run in the background.
- **World Monitoring & Visual Deltas:** Real-time ingestion of global events from conflict, market, and news feeds (ACLED, GDELT, AlphaVantage, RSS). Now supports **Article Images** and direct source linking.
- **Autonomous Synthesis & Rollups:** Automatic synthesis of raw data into hierarchical time periods (hour, day, week, month, year) for efficient AI grounding.
- **Interactive AI Regeneration:** Redo any monitoring summary or hierarchical rollup on-demand. Individual hour-deltas are refined, while rollups are re-synthesized from their constituent sub-summaries.
- **Symbolic Store & Graph Hygiene:** Integrated knowledge store with vector search. Includes automated "Symbolic Compression," "Canonical Merging," and "Bridge Lifting" to maintain a clean, high-signal knowledge graph.
- **System Tray & Screenshot Tool:** Integrated system bar icon for quick access. Includes a native **Screenshot Capture** tool that automatically processes, analyzes, and attaches visual context to your reasoning turns.
- **Multimodal Attachment Support:** Deep grounding in local files (PDF, HTML, RSS, JSON) and images. Vision models receive both a **symbolic grounding description** and the **raw base64 pixels** for direct visual reasoning.
- **Trace Visualization:** Real-time visualization of the reasoning process, showing activated symbols, tool execution paths, and multimodal grounding events.
- **Context Management:** Persistent conversation sessions with automated "Priming" for pre-caching relevant symbols and world deltas.
- **MCP Integration:** Native support for the Model Context Protocol (MCP), enabling extensible tool capabilities across local and remote servers.
- **Integrated Search:** Grounded web search and fetch capabilities with automated symbolic extraction.

## Installation

### Via Homebrew (macOS)
```bash
brew install --cask ./signalzero-desktop.rb
```

### From Source
Ensure you have [Node.js](https://nodejs.org/) installed on your system.

1. Clone the repository:
   ```bash
   git clone git@github.com:klietus/SignalZero-Desktop.git
   cd SignalZero-Desktop
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Technical Architecture

- **Hardware-Aware Inference Engine:** Priority-based locking system (User: High, Agent: Background) designed for high-performance Apple Silicon (M4) and local GPU rigs.
- **Neural Gating Layer:** A 0.8B parameter gating model that validates events against agent subscriptions before waking the heavy reasoning models.
- **Hierarchical Context Compression:** Multi-layered history management using semantic tool-stripping, 12-round summarization heartbeats, and token-aware sliding windows.
- **Normalized Persistence Layer:** Structured SQLite storage for relational metadata and attachments, paired with LanceDB for high-dimensional vector retrieval.
- **Event Bus Backbone:** Real-time communication between the main process (runners, providers) and the renderer (streaming thoughts, trace updates, system events).

## Data Providers

The kernel includes specialized handlers for:
- **Conflict Monitoring:** ACLED API integration for real-time conflict tracking.
- **Global Events:** GDELT Project integration for worldwide news events.
- **Financial Markets:** AlphaVantage and MarketStack for real-time market signals.
- **Regional News:** High-fidelity RSS processing for NYT, CNN, Al Jazeera, etc.
- **Custom Feeds:** Generic RSS, Web Scraping, and API polling support.

## Running the Application

### Development Mode
To start the application in development mode with hot-reloading:
```bash
npm run dev
```

### Production Preview
To build and preview the production version:
```bash
npm run start
```

## Building

To build the application for your current platform:

```bash
# General build (runs typecheck and electron-vite build)
npm run build

# Platform specific builds
npm run build:mac
npm run build:win
npm run build:linux
```

## Testing

Run the test suite using Vitest:
```bash
npm test
```

## Further Research & Theoretical Foundations

SignalZero is grounded in emerging research at the intersection of semiotics, cognitive science, and autonomous systems.

### 💠 Semiotics & Sign Systems
- **[Language Models as Semiotic Machines](https://arxiv.org/abs/2410.13065)** - Reconceptualizing AI through structuralist and post-structuralist linguistic theories.
- **[Not Minds, but Signs: Reframing LLMs through Semiotics](https://arxiv.org/abs/2505.17080)** - Analyzing LLMs as semiotic agents rather than cognitive ones.

### 🧠 Neuro-Symbolic Systems
- **[Neuro-Symbolic AI in 2024: A Systematic Review](https://arxiv.org/abs/2501.05435)** - The state of the art in integrating symbolic logic with neural networks.
- **[Neuro-Symbolic Artificial Intelligence: The State of the Art](https://arxiv.org/abs/2109.06133)** - Foundational concepts of hybrid AI architectures.

### 🌍 World Model AIs
- **[A Path Towards Autonomous Machine Intelligence](https://arxiv.org/abs/2306.02572)** - Yann LeCun's proposal for JEPA (Joint-Embedding Predictive Architecture).
- **[Mastering Diverse Domains through World Models](https://arxiv.org/abs/2301.04104)** - Detailed overview of the DreamerV3 reinforcement learning framework.

### ♻️ Recursive Context & Memory
- **[MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560)** - Managing infinite context through hierarchical memory and paging.
- **[Recursive Summarization for Long-Form Comprehension](https://arxiv.org/abs/2109.10686)** - Techniques for hierarchical state compression in LLM contexts.

### ⚓ Semantic Grounding
- **[Understanding AI: Semantic Grounding in Large Language Models](https://arxiv.org/abs/2402.10992)** - Investigating functional and causal grounding in modern transformers.
- **[Semantic Partial Grounding via LLMs](https://arxiv.org/abs/2602.22067)** - Using LLMs to prune irrelevant search spaces in classical planning tasks.

## License

This project is licensed under the **MIT License**. See the `LICENSE` file for more details.
