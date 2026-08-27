<div align="center">
  <table>
    <tr>
      <td align="right" valign="middle">
        <img src="ui/public/mimir_logo.png" alt="Mimir" width="120" height="120" />
      </td>
      <td align="left" valign="middle">
        <h1>ᛗᛁᛗᛁᚱ</h1>
      </td>
    </tr>
  </table>
</div>

Mimir is a Windows desktop assistant built with **Tauri**, **React/TypeScript**, and **Python sidecars**. It calls **[any LiteLLM-supported provider](https://docs.litellm.ai/docs/providers)** with your own API key.

Press a global hotkey from whatever app you're in, grab context from the screen, and ask about it in a small floating chat window. Works on selected text or anything visible — code, docs, error dialogs, charts, PDFs, browser pages.

---

## What it does

* **Global hotkey** (`Ctrl+Space` by default, rebindable) — opens the chat card at your cursor while the listener is live.
* **Ask about what's on screen** — Mimir pulls context from your desktop before you type:
  * **Text selected** — the highlight is sent as chat context.
  * **Nothing selected** — a screen overlay lets you drag a box around any region; that snippet goes into the chat (requires a vision-capable model).
  * You stay in the app you were using; no copy-paste or screenshot folder workflow.
* **Chat card** — frameless overlay. Double-click the header to lock it open; press the hotkey again to capture new context.
* **Console** — provider/model settings, API key, live/sleep toggle, hotkey config, and chat history.
* **Chat threads** — saved locally on disk; browse and reopen them from the Console or the card's history menu.

Click outside the chat card to dismiss it (unless locked). That clears the in-memory session on the card; saved threads are unchanged.

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

### 3. API Key & Model Configuration
Mimir stores settings locally via Tauri Store. No `.env` required.
1. Run the app in dev mode (`npm run dev`).
2. In the **Console**, open **Model** — paste your API key, pick a provider, and select a vision-capable model.

### 4. Running in Dev Mode
From the root directory:
```bash
npm run dev
```
Console opens on launch. Press `Ctrl+Space` (while **Live**) to open the chat card at your cursor.

---

## Download & Install

**Requires Windows 10 or 11 (64-bit).**

1. Download **`Mimir_*_x64-setup.exe`** from [GitHub Releases](https://github.com/madhavc21/Mimir/releases) (latest `v1.x` tag).
2. Run the installer and launch Mimir. The **Console** window opens on first start.
3. Open **Model** in the Console sidebar — paste your API key, pick a provider, and select a vision-capable model (needed for screen-region capture).
4. Press your capture hotkey (`Ctrl+Space` by default) from any app while Mimir is **Live**.

### If the installer won't run or the app closes immediately

Unsigned / niche desktop apps are often flagged as **potentially unwanted applications (PUA)** by Microsoft Defender. Turn off PUA blocking before installing:

**Windows 11 and Windows 10** (same path in the Windows Security app):

```text
Windows Security  →  App & browser control  →  Reputation-based protection settings
  →  Potentially unwanted app blocking: Off
```

**Windows 10** (alternate route via Settings):

```text
Start  →  Settings  →  Update & Security  →  Windows Security  →  Open Windows Security
  →  App & browser control  →  Reputation-based protection settings
  →  Potentially unwanted app blocking: Off
```

**Windows 8.1** — no "Reputation-based protection" page in Windows Security. Use PowerShell **as Administrator**:

```powershell
Set-MpPreference -PUAProtection Disabled
```

**Windows 7** — this Defender setting does not exist. Mimir is not supported on Windows 7.

After installing, you can turn PUA blocking back on. If Defender quarantined Mimir, open **Windows Security → Virus & threat protection → Protection history**, allow or restore the file, then reinstall.

---

## Build from source

### 1. Build Python Binaries

The Rust app expects pre-compiled binaries in `src-tauri/binaries/`.

> **Note on sidecar formats:**
> - `capture` is built as **onefile** — produces a single `dist/capture.exe`.
> - `chat` is built as **onedir** — produces a `dist/chat/` folder. This avoids the per-launch
>   temp-unpack overhead of onefile, giving faster cold-start after the daemon is first spawned.

```bash
cd sidecars
.venv\Scripts\activate
# Install PyInstaller if not present
pip install pyinstaller

# Build capture (onefile)
pyinstaller capture.spec

# Build chat (onedir)
pyinstaller chat.spec
```

### 2. Stage Binaries for Tauri

From `sidecars/` (with the venv active):
```bash
python stage_binaries.py
```

This script:
- Removes any stale binary at the destination path before staging (prevents old builds from being silently picked up)
- Moves `dist/capture.exe` → `src-tauri/binaries/capture-<triple>.exe`
- Moves `dist/chat.exe` → `src-tauri/binaries/chat-<triple>.exe`

The `<triple>` is your host Rust target (e.g. `x86_64-pc-windows-msvc`), queried from `rustc --print host-tuple`.

### 3. Build the Tauri App

```bash
cd.. # From the root directory
npm run build
```

Installers land in `src-tauri/target/release/bundle/`:
- **NSIS installer**: `bundle/nsis/Mimir_*_x64-setup.exe` (primary release asset)
- **MSI**: `bundle/msi/Mimir_*_x64_en-US.msi` (optional)

---

## License

Apache 2.0 — see [LICENSE](LICENSE).
