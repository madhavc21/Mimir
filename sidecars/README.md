# Mimir — Python Sidecars

Python services spawned by the Tauri shell plugin:

- **`capture.py`** — reads selected text or captures a screen region (PNG for vision models)
- **`chat.py`** — LiteLLM streaming, provider catalog, vision-only model listing

Dev: run via `.venv` Python. Prod: PyInstaller binaries in `src-tauri/binaries/`.

API key is injected at runtime as `MIMIR_API_KEY` (not hardcoded to a single provider).
