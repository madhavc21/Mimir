# Buddy AI Assistant

Buddy is an ultra-fast, context-aware AI desktop assistant built with **Tauri v2**, **React/TypeScript**, and a **Python-based LLM sidecar** running **Gemini 2.5 Flash Lite** (via LiteLLM).

It stays hidden until you press a global hotkey, then springs to life instantly at your cursor.

---

## 🚀 Key Features

*   **Global Hotkey Hook**: Trigger the assistant instantly from any app using `Ctrl+Shift+E`.
*   **Context-Aware Triggers**:
    *   If you have text selected on your screen when pressing the hotkey, Buddy automatically captures and inputs it as context.
    *   If no text is selected, Buddy triggers a custom cross-process **screen capture crop overlay** allowing you to draw a box around anything on your screen (code, graphs, error messages) and ask questions about it.
*   **Glassmorphism Theme**: Premium native Windows Acrylic blurred dark UI that matches the OS aesthetic.
*   **Real-time Streaming**: Instant token-by-token streaming via low-latency Rust-to-Python stdout pipelines.
*   **Ephemeral Memory**: Chat history is maintained dynamically while you are focused on the app, but automatically resets when you click away to ensure a clean slate and keep tokens efficient.

---

## 🏗️ Architecture Overview

```text
[React Frontend] (Webview)
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

- **UI (`ui/`)**: React frontend handling the visual interface and settings management via Tauri Store.
- **Rust Core (`src-tauri/`)**: Handles global hotkeys, window management, and spawns the Python sidecars.
- **Python Sidecars (`sidecars/`)**: Does the heavy lifting for OS integrations (clipboard/screen capture) and LLM communication.

---

## 🛠️ Development Setup

### Prerequisites
*   [Node.js](https://nodejs.org/) (v18+)
*   [Rust/Cargo](https://www.rust-lang.org/tools/install)
*   [Python 3.10+](https://www.python.org/downloads/)

### 1. Root & UI Dependencies
Navigate to the root directory and install the Node dependencies for both the root workspace and the UI.
```bash
npm install
cd ui
npm install
cd ..
```

### 2. Python Sidecar Setup
The dev environment runs the Python scripts directly via a virtual environment managed by `uv`.
```bash
cd sidecars
uv sync
# Activate the environment (Windows)
.venv\Scripts\activate
cd ..
```

### 3. API Key Configuration
Buddy securely stores your API key on disk using the Tauri Store plugin. You do **not** need a `.env` file.
1. Run the app in dev mode.
2. Click the Settings (gear) icon.
3. Paste your Gemini API key and close settings to save.

### 4. Running in Dev Mode
From the root directory:
```bash
npm run dev
```
This starts the Vite development server and compiles the Rust application. The window will start hidden — press `Ctrl+Shift+E` to trigger it.

---

## 📦 Production Build

To build a standalone production executable, you must first compile the Python sidecars into binaries, and then package the Tauri app.

### 1. Build Python Binaries
The production Rust app expects pre-compiled executables in `src-tauri/binaries/`.
```bash
cd sidecars
.venv\Scripts\activate
# Install PyInstaller if not present
pip install pyinstaller

# Build the standalone executables
pyinstaller --onefile --name capture capture.py
pyinstaller --onefile --collect-data="litellm" --hidden-import="tiktoken_ext.openai_public" --hidden-import="tiktoken_ext" --name chat chat.py
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
The final installer and standalone `.exe` will be located in `src-tauri/target/release/`.
