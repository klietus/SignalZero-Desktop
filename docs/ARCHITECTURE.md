# SignalZero Desktop Architecture

SignalZero Desktop is a recursive symbolic reasoning system built on a local-first, service-oriented architecture. It utilizes Electron to provide a bridge between native hardware performance and a modern reactive interface.

## 1. Process Model

The system is split into two primary execution environments:

### Main Process (The Kernel)
The **Kernel** is the heart of the system, running in the Electron main process. It manages:
- **Service Orchestration:** Initializing and coordinating all backend services (Inference, Topology, Monitoring, etc.).
- **Hardware Management:** Managing GPU/CPU resources via an inference priority lock.
- **Persistence:** Direct access to SQLite (relational) and LanceDB (vector) stores.
- **Background Runners:** Autonomous loops for agent execution and graph hygiene.
- **Native Integration:** System tray management, file system access, and screenshot capturing.

### Renderer Process (The Workspace)
The **Workspace** is a React-based single-page application. It is responsible for:
- **Context Visualization:** Rendering chat histories and symbolic traces.
- **User Interaction:** Chat input, forge management, and settings configuration.
- **Real-time Updates:** Listening to the Kernel's event bus for streaming thoughts and system status.

## 2. The Service Layer

The Kernel is organized into specialized services located in `src/main/services/`:

| Service | Responsibility |
| :--- | :--- |
| **InferenceService** | Manages LLM providers, tool execution loops, and the priority lock. |
| **TopologyService** | Performs background graph analysis, hygiene, and self-organization. |
| **AgentRunner** | Triggers autonomous agent turns based on real-time world deltas. |
| **MonitoringService** | Polls external APIs/RSS and synthesizes them into hierarchical deltas. |
| **DomainService** | Manages symbolic domains, symbol CRUD, and vector indexing. |
| **DocumentMeaningService** | Parses local attachments and performs multimodal vision analysis. |
| **EventBusService** | Central nervous system for internal and cross-process communication. |

## 3. Communication Patterns

### IPC (Inter-Process Communication)
The Renderer communicates with the Main process through a strictly defined `window.api` exposed via `src/preload/index.ts`. Most actions follow a Request/Response pattern using `ipcRenderer.invoke`.

### Event Bus (The Nervous System)
For high-frequency or asynchronous updates (like streaming inference chunks or background hygiene logs), the Main process broadcasts events via `broadcast()` in `main/index.ts`. The Renderer listens for these via `window.api.onKernelEvent`.

## 4. Concurrency & Resource Management

To prevent "GPU Starvation" on local hardware, the system implements a **Priority-Aware Inference Lock**:
- **Priority 1 (User Chat):** Jumps to the front of the queue for immediate responsiveness.
- **Priority 0 (Background Agents):** Runs only when the hardware is idle or between user turns.
- **Hardware Awareness:** The lock only enforces a queue if the inference provider is `local`. Cloud-based providers (Gemini/OpenAI) can run in parallel with local tasks.
