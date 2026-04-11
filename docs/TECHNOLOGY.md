# SignalZero Technology Stack

SignalZero Desktop leverages a modern, high-performance stack designed for data sovereignty and local hardware acceleration.

## 1. Core Runtime & Frameworks
- **Electron:** Cross-platform application shell, enabling native system integration (Tray, Screenshots, File System) alongside a web-based UI.
- **Node.js:** Backend runtime for the Kernel process.
- **Vite:** Next-generation build tool used via `electron-vite` for extremely fast development cycles and optimized production bundles.

## 2. Frontend (The Workspace)
- **React:** Component-based UI library.
- **TypeScript:** Strict typing across the entire codebase to ensure structural integrity.
- **TailwindCSS:** Utility-first CSS framework for a responsive, modern interface.
- **Lucide React:** High-quality, consistent iconography for system status and actions.
- **React-Markdown:** Handles the rendering of complex AI outputs, including tables, code blocks, and visual images.

## 3. Persistence & Vector Compute
- **Better-SQLite3:** High-speed relational database for conversation history, symbol metadata, and agent logs. Chosen for its synchronous API which simplifies local data management.
- **@lancedb/lancedb:** A local-first vector database used for high-dimensional similarity search. It stores embeddings for:
    - **Symbols:** Enabling semantic retrieval of knowledge.
    - **World Deltas:** Enabling agents to find relevant historical events.
- **js-tiktoken:** Local token estimation to manage the 100k token context window budget without external API calls.

## 4. AI & Multimodal Integration
- **@google/generative-ai:** Native SDK for Gemini 2.5 Pro and Flash integration.
- **OpenAI SDK:** Used for OpenAI (GPT-4o) and **Local Inference** (LM Studio, Ollama) via OpenAI-compatible endpoints.
- **Sharp:** High-performance image processing for thumbnail generation and vision-prep.
- **pdf-parse / jsdom:** Used by `DocumentMeaningService` to extract clean text from local attachments.

## 5. Automation & Tooling
- **Model Context Protocol (MCP):** Native integration for extensible tool sets, allowing the kernel to connect to local and remote MCP servers.
- **Vitest:** Blazing fast unit and integration testing framework used to validate core logic like JSON extraction and topology algorithms.
- **Electron-Builder:** Packages the application into native DMG (macOS), EXE (Windows), and AppImage (Linux) formats.
