# Mimir — React UI

Vite + React + TypeScript frontend. Two entrypoints:

- `index.html` → Chat card (hotkey overlay, streaming conversation)
- `console.html` → Console (provider/model settings, hotkeys, chat history, live/sleep)

Settings are persisted via `@tauri-apps/plugin-store` (`settings.json`). Model discovery calls Rust → `chat` sidecar → LiteLLM.
