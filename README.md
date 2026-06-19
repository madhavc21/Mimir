<p align="center">
  <img src="ui/public/mimir_logo.png" alt="Mimir" width="160" />
</p>

# Mimir

Mimir is an ultra-fast, context-aware AI desktop assistant built with **Tauri v2**, **React/TypeScript**, and a **Python-based LLM sidecar** running **Gemini** (via LiteLLM).

It stays in the background until you press a global hotkey, then springs to life instantly at your cursor.

---

## Key Features

*   **Global Hotkey Hook**: Trigger the assistant instantly from any app using `Ctrl+Shift+E`.
*   **Context-Aware Triggers**:
    *   If you have text selected on your screen when pressing the hotkey, Mimir automatically captures and inputs it as context.
    *   If no text is selected, Mimir triggers a custom cross-process **screen capture crop overlay** allowing you to draw a box around anything on your screen (code, graphs, error messages) and ask questions about it.
*   **Dual-window architecture**: **Console** (config hub) + **Chat card** (ephemeral overlay).
*   **Glassmorphism Theme**: Native Windows Acrylic blurred dark chat UI.
*   **Real-time Streaming**: Instant token-by-token streaming via low-latency Rust-to-Python stdout pipelines.
*   **Ephemeral Memory**: Chat history resets when you click away to keep sessions clean and token-efficient.

---

## Architecture Overview

```text
[Console UI]  console.html  →  settings, live/sleep, quit
[Chat UI]     index.html     →  capture context + conversation

       │ ▲
       │ │  Tauri IPC (invokes & events)
       ▼ │
  [Rust Core] (Tauri App)
       │ ▲
       │ │  Shell plugin spawn + event stream
       ▼ │
[Python Sidecars] (Dev: .venv | Prod: Standalone .exe)
  ├── capture  (Text & screen snippet capture)
  └── chat     (LiteLLM Gemini vision streaming)
```

- **UI (`ui/`)**: Two Vite entrypoints — Console hub and Chat card satellite.
- **Rust Core (`src-tauri/`)**: Hotkeys, window management, settings reads, sidecar spawn.
- **Python Sidecars (`sidecars/`)**: OS capture integrations and LLM streaming.

---

## Development Setup

### Prerequisites
*   [Node.js](https://nodejs.org/) (v18+)
*   [Rust/Cargo](https://www.rust-lang.org/tools/install)
*   [Python 3.10+](https://www.python.org/downloads/)

### 1. Root & UI Dependencies
```bash
npm install
cd ui
npm install
cd ..
```

### 2. Python Sidecar Setup
```bash
cd sidecars
uv sync
.venv\Scripts\activate
cd ..
```

### 3. API Key Configuration
Mimir stores your API key locally via Tauri Store. No `.env` required.
1. Run the app in dev mode (`npm run dev`).
2. In the **Console** window, open **API Keys** and save your Gemini key.

### 4. Running in Dev Mode
From the root directory:
```bash
npm run dev
```
Console opens on launch. Press `Ctrl+Shift+E` (while **Live**) to open the chat card at your cursor.

---

## 📦 Production Build

## Production Build

### 1. Build Python Binaries
The production Rust app expects pre-compiled executables in `src-tauri/binaries/`.
```bash
cd sidecars
.venv\Scripts\activate
# Install PyInstaller if not present
pip install pyinstaller

# Build the standalone executables
pyinstaller capture.spec
pyinstaller chat.spec
```

### 2. Stage Binaries for Tauri
From `sidecars/` (with the venv active):
```bash
python stage_binaries.py
```
This moves `dist/capture.exe` and `dist/chat.exe` into `src-tauri/binaries/` with the correct `rustc` target-triple suffix.

### 3. Build the Tauri App
From the root directory:
```bash
npm run build
```

Installers land in `src-tauri/target/release/bundle/`:
- **NSIS installer**: `bundle/nsis/Mimir_*_x64-setup.exe` (primary release asset)
- **MSI**: `bundle/msi/Mimir_*_x64_en-US.msi` (optional)
