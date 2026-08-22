use tauri::{AppHandle, Manager};

use crate::chat_daemon::ChatDaemon;
use crate::settings::ModelInfo;

// ---------------------------------------------------------------------------
// capture.exe — one-shot, unchanged
// ---------------------------------------------------------------------------

pub async fn run_capture(app: &AppHandle) -> Result<tauri_plugin_shell::process::Output, String> {
    use tauri_plugin_shell::ShellExt;

    let cmd = if cfg!(debug_assertions) {
        app.shell()
            .command("../sidecars/.venv/Scripts/python")
            .args(["../sidecars/capture.py"])
    } else {
        app.shell()
            .sidecar("capture")
            .map_err(|e| e.to_string())?
    };

    cmd.output().await.map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Chat — all ops delegated to ChatDaemon
// ---------------------------------------------------------------------------

pub async fn stream_chat(
    app: AppHandle,
    message: String,
    image_path: String,
    history_json: String,
    api_key: String,
    model: String,
    target_window: String,
) -> Result<(), String> {
    app.state::<ChatDaemon>()
        .rpc_stream(&app, message, image_path, history_json, api_key, model, target_window)
        .await
}

pub async fn list_providers(app: &AppHandle) -> Result<Vec<String>, String> {
    app.state::<ChatDaemon>().rpc_list_providers(app).await
}

pub async fn list_models(
    app: &AppHandle,
    provider: &str,
    api_key: &str,
) -> Result<Vec<ModelInfo>, String> {
    app.state::<ChatDaemon>()
        .rpc_list_models(app, provider.to_string(), api_key.to_string())
        .await
}
