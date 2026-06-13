# Buddy AI - Python Sidecars

This directory contains the Python backend services that power Buddy's OS-level integrations and AI capabilities.

The sidecars are designed to be run as direct Python scripts during development, but are compiled into standalone Windows executables (`.exe`) via PyInstaller for production distribution.

## 🛠️ Development Setup

The Rust backend in dev mode (`npm run dev`) will automatically attempt to execute the `.py` scripts using the virtual environment in this directory.

1. **Sync dependencies using uv**:
   ```bash
   uv sync
   ```

2. **Activate the environment**:
   ```bash
   # Windows
   .venv\Scripts\activate
   ```

> **Note**: You do not need a `.env` file for the API key. The API key is managed securely via the React UI and injected into the Python process by the Rust backend at runtime.

---

## 📦 Production Build

Tauri's production build (`npm run tauri build`) requires these Python scripts to be pre-compiled into standalone binaries.

1. **Activate your virtual environment**:
   ```bash
   .venv\Scripts\activate
   ```

2. **Build the standalone executables using PyInstaller**:
   We use `--onefile` to package everything into a single `.exe`. `chat.py` requires specific hidden imports and data collections for `litellm` and `tiktoken`.
   ```bash
   pip install pyinstaller
   pyinstaller --onefile --name capture capture.py
   pyinstaller --onefile --collect-data="litellm" --hidden-import="tiktoken_ext.openai_public" --hidden-import="tiktoken_ext" --name chat chat.py
   
   ```

3. **Stage binaries for Tauri**:
   Tauri requires sidecar binaries to be suffixed with the host target triple (from `rustc --print host-tuple`). From this `sidecars/` directory:

   ```bash
   python stage_binaries.py
   ```

   Works on Windows (PowerShell). Requires `rustc` on PATH.

Once the binaries are in place, running `npm run build` from the root directory will automatically bundle them into the final MSI/EXE installer.
