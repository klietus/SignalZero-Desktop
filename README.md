# SignalZero Desktop

SignalZero Recursive Symbolic Kernel - Desktop Edition.

## Overview

SignalZero Desktop is a sophisticated recursive symbolic reasoning engine built as a desktop application using Electron, Vite, and React. It provides a robust environment for managing symbolic contexts, executing tool-based reasoning, and visualizing complex information traces.

## Key Features

- **Recursive Symbolic Reasoning:** Advanced inference engine with tool integration.
- **Context Management:** Create, list, and manage persistent conversation sessions.
- **Symbolic Store:** Integrated symbol store with vector search capabilities.
- **Trace Visualization:** Real-time reasoning trace visualization.
- **MCP Integration:** Support for Model Context Protocol (MCP) tools.
- **Attachment Support:** Handle and analyze file attachments within the reasoning loop.

## Installation

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

This project is licensed under the CC-BY-NC-4.0 license. See the `LICENSE` file for more details.
