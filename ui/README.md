# Buddy AI - React UI

This directory contains the Vite + React + TypeScript frontend for the Buddy AI assistant.

It relies on Tauri's IPC (Inter-Process Communication) to communicate with the Rust backend, which means running this UI completely independently in a browser will result in missing functionality (like hotkeys and Python sidecar integrations).

## 🛠️ Development Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Running the App**:
   You should **not** run the UI independently using `npm run dev` inside this folder.
   
   Instead, navigate to the **root repository directory** and run:
   ```bash
   npm run dev
   ```
   This root command will automatically boot up Vite, compile the Rust backend, and link them together in the Tauri development window.

## ⚙️ Key Concepts

- **Tauri Store**: The UI utilizes `@tauri-apps/plugin-store` to securely save user settings (like the Gemini API key) to disk. This replaces the need for standard `.env` files in production.
- **Glassmorphism**: The styling uses native Windows Acrylic transparency. The `tauri.conf.json` enables window transparency, and CSS relies on `rgba` background values to achieve the frosted glass effect.
- **IPC Events**: The frontend listens for events emitted by the Rust backend (e.g., `capture-text` and `capture-screen`) to know when to update the interface with new context grabbed by the Python sidecars.
