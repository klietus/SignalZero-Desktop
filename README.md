# SignalZero Desktop

SignalZero Recursive Symbolic Kernel - Desktop Edition.

## Demo

[![SignalZero Desktop Demo](https://img.youtube.com/vi/Ys6TIy5-0Gs/maxresdefault.jpg)](https://youtu.be/Ys6TIy5-0Gs)

*Click the image above to watch the demo on YouTube.*

## Overview

SignalZero Desktop is a sophisticated recursive symbolic reasoning engine built as a desktop application using Electron, Vite, and React. It provides a robust environment for managing symbolic contexts, executing tool-based reasoning, and visualizing complex information traces.

## Key Features

- **Recursive Symbolic Reasoning:** Advanced inference engine with multi-step tool integration and trace-based reasoning.
- **World Monitoring & Data Feeds:** Real-time ingestion of global events and data from sources like ACLED (conflict), GDELT (events), AlphaVantage (markets), and customizable RSS/Web feeds.
- **Autonomous Synthesis & Rollups:** Automatic synthesis of raw data into hierarchical time periods (hour, day, week, month, year) for efficient AI grounding. Supports on-demand synthesis for missing or stale time ranges.
- **Symbolic Store & Graph Hygiene:** Integrated knowledge store with vector search. Includes automated "Symbolic Compression" and "Canonical Merging" to maintain a clean, high-signal knowledge graph.
- **Trace Visualization:** Real-time visualization of the reasoning process, showing activated symbols and tool execution paths.
- **Context Management:** Persistent conversation sessions with automated "Priming" for pre-caching relevant symbols and world deltas.
- **MCP Integration:** Native support for the Model Context Protocol (MCP), enabling extensible tool capabilities.
- **Attachment Support:** Analyze and ground reasoning in local file attachments.
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

- **Recursive Inference Engine:** Multi-turn tool execution loop with automated context priming.
- **Monitoring & Synthesis Pipeline:** Parallelized polling, itemization, and LLM-based summarization of world data.
- **Hierarchical Rollups:** Recursive synthesis of data (e.g., hours -> days -> weeks) with staleness checks for current periods.
- **Vector Search Store:** Efficient local vector retrieval powered by LanceDB for both symbols and world deltas.
- **Symbolic Cleanup:** Automated canonical ID selection and graph merging based on semantic and temporal signals.

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

## License

This project is licensed under the **MIT License**. See the `LICENSE` file for more details.
