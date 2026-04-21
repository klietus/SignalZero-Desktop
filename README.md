# SignalZero Desktop

SignalZero Recursive Symbolic Kernel - Desktop Edition.

## Demo

[![SignalZero Desktop Demo](https://img.youtube.com/vi/Ys6TIy5-0Gs/maxresdefault.jpg)](https://youtu.be/Ys6TIy5-0Gs)

*Click the image above to watch the demo on YouTube.*

## Overview

SignalZero Desktop is a sophisticated recursive symbolic reasoning engine that serves as an autonomous "situational agent." Built on Electron, Vite, and React, it bridges the gap between raw neural perception and structured symbolic reasoning. It uses local hardware (optimized for M4 Max) to monitor audio, camera, and screen feeds, detecting real-time environmental "spikes" and promoting significant events to its symbolic core for proactive assistance.

## Key Features

### 💠 Recursive Symbolic Core
- **Recursive Reasoning:** Multi-step tool integration with recursive trace-based inference.
- **Symbolic Store & Graph Hygiene:** Knowledge store with vector search. Includes automated "Symbolic Compression," "Canonical Merging," and "Bridge Lifting" to maintain a clean, high-signal knowledge graph.
- **Context Management:** Persistent conversation sessions with automated "Priming" to pre-cache relevant symbols and world deltas.
- **Trace Visualization:** Real-time visualization of activated symbols, tool execution paths, and multimodal grounding.

### 🏠 Local-First & Cross-Model Flexibility
- **Provider Agnostic:** Native support for **Gemini 1.5/2.0**, **OpenAI (GPT-4o/o1)**, and **Local Models** (Ollama, LM Studio, vLLM).
- **Privacy-Centric Architecture:** Primary processing, symbolic storage, and high-frequency perception data remain on local hardware.
- **MCP Integration:** Native support for the **Model Context Protocol (MCP)**, enabling extensible tool capabilities across local and remote servers.
- **Integrated Search & Fetch:** Grounded web search (SerpApi, Brave, Tavily) and fetch capabilities with automated symbolic extraction.
- **Universal Attachment Support:** Deep grounding in local files (**PDF, HTML, RSS, JSON**) and images.

### 👁️ Real-time Perception (Optical & Acoustic Link)

- **Neural Perception Dashboard:** A high-density, real-time monitoring interface for camera, screen, and acoustic streams.
- **HSEmotion (Metal-Accelerated):** State-of-the-art research-backed emotion recognition utilizing **EfficientNet-B0** with **Metal (MPS) acceleration**.
- **MediaPipe V2 Integration:** High-fidelity 52-coefficient blendshape tracking (ARKit standard) for physical facial movement validation and **Neutral Baseline Calibration**.
- **Optical App Tracking:** Uses macOS Accessibility features to track the active application and window titles in real-time.
- **Diarized Acoustic Stream:** Real-time multi-speaker separation and tracking. Detects vocal prosody (Excited, Tense, Calm) directly from the acoustic waveform.
- **High-Fidelity Multimodal Inference:** Automatically extracts perception frames and attaches them as **raw multimodal image parts** to inference rounds, allowing the model to "see" your screen and face directly.

### 🧠 Autonomous Situational Intelligence
- **Perception Spike Detection:** A "subconscious" background layer that monitors sensory deltas over a 15-second sliding window.
- **Situational Flash Rounds:** Silent, lightweight background evaluations that decide if a perceived event (emotion shift, app crash, intense debate) warrants kernel attention.
- **Autonomous Promotion:** Proactively "promotes" significant events to the main Symbolic Kernel, triggering autonomous interventions in a dedicated reasoning stream.
- **Acoustic Feedback Filtering:** "Mic Suppression" logic that automatically silences the microphone during AI speech playback to prevent self-looping hallucinations.

### 🌍 World Monitoring & Ingestion
- **Event-Driven Agents:** Specialized agents (like the *Symbolic Cartographer*) that react to global feeds in real-time with persistent delta tracking.
- **Dynamic Feed Monitoring:** Ingestion of global events from ACLED (conflict), Market signals, and high-fidelity RSS (NYT, CNN, Al Jazeera).
- **Hierarchical Synthesis:** Automatic rollup of raw world data into temporal summaries (hour, day, week, month, year) for efficient AI grounding.

## Technical Architecture & Performance

- **M4 Max Hardware Optimization:** Specifically engineered for Apple Silicon with **Metal (MPS)** offloading for neural vision and speaker verification models.
- **Asynchronous Worker Pool:** Offloads CPU-intensive tasks (Large JSON parsing, thought-stripping) to a multi-threaded **WorkerPool** to maintain a fluid 60FPS UI.
- **IPC Batching Engine:** High-frequency perception data is throttled via a 5Hz/10Hz batching engine to minimize renderer process overhead.
- **Hybrid Persistence Layer:** Structured SQLite for relational metadata and LanceDB for high-dimensional vector retrieval.
- **Neural Gating Layer:** A 0.8B parameter "Vibe Check" model validates events against agent subscriptions before engaging heavy reasoning models.

## Installation

### Via Homebrew (macOS)
```bash
# Add the tap
brew tap klietus/signalzero-desktop https://github.com/klietus/SignalZero-Desktop.git

# Install the cask
brew install --cask klietus/signalzero-desktop/signalzero-desktop
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

3. Setup Sidecar Environments:
   ```bash
   # Initialize the portable Python environments
   ./sidecars/voice/setup_portable.sh
   ./sidecars/vision/setup_portable.sh
   ```

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

```bash
# General build (runs typecheck and electron-vite build)
npm run build

# Platform specific builds
npm run build:mac
```

## Testing

Run the test suite using Vitest:
```bash
npm test
```

## Further Research & Theoretical Foundations

SignalZero is grounded in emerging research at the intersection of semiotics, cognitive science, and autonomous systems.

### 💠 Semiotics & Sign Systems
- **[Language Models as Semiotic Machines](https://arxiv.org/abs/2410.13065)**
- **[Not Minds, but Signs: Reframing LLMs through Semiotics](https://arxiv.org/abs/2505.17080)**

### 🧠 Neuro-Symbolic Systems
- **[Neuro-Symbolic AI in 2024: A Systematic Review](https://arxiv.org/abs/2501.05435)**
- **[Neuro-Symbolic Artificial Intelligence: The State of the Art](https://arxiv.org/abs/2109.06133)**

### 🌍 World Model AIs
- **[A Path Towards Autonomous Machine Intelligence](https://arxiv.org/abs/2306.02572)**
- **[Mastering Diverse Domains through World Models](https://arxiv.org/abs/2301.04104)**

### ⚓ Semantic Grounding
- **[Understanding AI: Semantic Grounding in Large Language Models](https://arxiv.org/abs/2402.10992)**
- **[Semantic Partial Grounding via LLMs](https://arxiv.org/abs/2602.22067)**

## License

This project is licensed under the **MIT License**. See the `LICENSE` file for more details.
