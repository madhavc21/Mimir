# Mimir — Python Sidecars

Python services managed by the Tauri shell plugin.

| Sidecar | Role | Build format | Invocation |
|---------|------|-------------|------------|
| `capture.py` | Reads selected text or captures a screen region (PNG for vision models) | **onefile** exe | One-shot spawn per hotkey press; Rust calls `.output().await` |
| `chat.py` | LiteLLM streaming, provider catalog, vision-only model listing | **onefile** exe | Long-lived **daemon** process; Rust communicates over stdin/stdout JSON |

---

## chat.py — Daemon protocol

`chat.py` runs in `--daemon` mode. It starts up, imports all dependencies (litellm, PIL), then emits:

```json
{"type": "ready"}
```

After that it reads newline-delimited JSON requests from stdin and writes responses to stdout.

**Request shapes (Rust → Python stdin):**
```json
{"id":"1","op":"stream","message":"...","image_path":"...","history":[],"model":"provider/model","api_key":"..."}
{"id":"2","op":"list_providers"}
{"id":"3","op":"list_models","provider":"gemini","api_key":"..."}
```

**Response shapes (Python stdout → Rust):**
```json
{"token": "partial accumulated text"}          // stream: one line per chunk
{"id":"1","type":"done"}                        // stream or list: signals completion
{"id":"3","result":[...]}                       // list: the payload line (before done)
{"id":"1","status":"error","message":"..."}     // any op: error, replaces done
```

All responses are newline-terminated. `sys.stdout.flush()` is called after every write.

---

## capture.py — One-shot

Spawned fresh on each hotkey press. Tries selected text first; falls back to overlay screenshot. Returns a single JSON object on stdout, then exits.

---

## Logs

In development: `sidecars/logs/sidecar.log`  
In production: `%TEMP%\mimir_logs\sidecar.log`

---

## Dev

Run via `.venv` Python — Rust uses `../sidecars/.venv/Scripts/python` directly.

```bash
cd sidecars
uv sync
.venv\Scripts\activate
```

## Prod

PyInstaller binaries staged into `src-tauri/binaries/`:
- `capture-<triple>.exe` — single file
- `chat-<triple>/` — folder (onedir; launcher exe inside, `_internal/` alongside)

API key is passed **per-request in JSON** (chat daemon), not as an env var. No hardcoded provider.
