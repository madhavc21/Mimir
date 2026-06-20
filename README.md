<p align="center">
  <span style="display: inline-flex; align-items: center; gap: 20px;">
    <img src="ui/public/mimir_logo.png" alt="Mimir" width="120" height="120" />
    <span style="font-size: 5rem; line-height: 1; color: #c084fc; letter-spacing: 0.05em;">ᛗᛁᛗᛁᚱ</span>
  </span>
</p>

Mimir is a Windows desktop assistant built with **Tauri**, **React/TypeScript**, and **Python sidecars** that talk to **Gemini** through LiteLLM.

Press a global hotkey from whatever app you're in, grab context from the screen, and ask about it in a small floating chat window. Works on selected text or anything visible — code, docs, error dialogs, charts, PDFs, browser pages.

---

## What it does

* **Global hotkey** (`Ctrl+Shift+E` by default) — opens the chat card at your cursor while the listener is live.
* **Ask about what's on screen** — Mimir pulls context from your desktop before you type:
  * **Text selected** — the highlight is sent as chat context.
  * **Nothing selected** — a screen overlay lets you drag a box around any region; that snippet goes into the chat (vision model reads the image).
  * You stay in the app you were using; no copy-paste or screenshot folder workflow.
* **Chat card** — frameless overlay for the conversation.
* **Console** — settings, API keys, live/sleep toggle, and chat history.
* **Chat threads** — saved locally on disk; browse and reopen them from the Console or the card's history menu.

Click outside the chat card to dismiss it (unless locked). That clears the in-memory session on the card; saved threads are unchanged.

---

## How it's put together

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
  ├── capture  (text + screen region capture)
  └── chat     (LiteLLM Gemini streaming)
```

- **UI (`ui/`)** — two Vite entrypoints: Console and chat card.
- **Rust (`src-tauri/`)** — hotkeys, window management, settings, sidecar spawn, thread storage.
- **Python (`sidecars/`)** — OS capture helpers and LLM streaming.

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
