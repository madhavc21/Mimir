use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

use crate::settings::{ModelInfo, MIMIR_API_KEY_ENV};

fn is_dev() -> bool {
    cfg!(debug_assertions)
}

fn chat_cmd(app: &AppHandle, args: &[&str]) -> Result<tauri_plugin_shell::process::Command, String> {
    if is_dev() {
        Ok(app
            .shell()
            .command("../sidecars/.venv/Scripts/python")
            .args(std::iter::once("../sidecars/chat.py").chain(args.iter().copied())))
    } else {
        Ok(app
            .shell()
            .sidecar("chat")
            .map_err(|e| e.to_string())?
            .args(args))
    }
}

pub async fn run_capture(app: &AppHandle) -> Result<tauri_plugin_shell::process::Output, String> {
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

pub async fn list_providers(app: &AppHandle) -> Result<Vec<String>, String> {
    let output = chat_cmd(app, &["--list-providers"])?
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(if stderr.is_empty() {
            "Provider list failed".into()
        } else {
            stderr.to_string()
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&stdout).map_err(|e| format!("Invalid provider list JSON: {e}"))
}

pub async fn list_models(
    app: &AppHandle,
    provider: &str,
    api_key: &str,
) -> Result<Vec<ModelInfo>, String> {
    let output = chat_cmd(app, &["--list-models", provider])?
        .env(MIMIR_API_KEY_ENV, api_key)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(if stderr.is_empty() {
            "Model list failed".into()
        } else {
            stderr.to_string()
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(&stdout).map_err(|e| format!("Invalid model list JSON: {e}"))
}

pub async fn stream_chat(
    app: AppHandle,
    message: String,
    image_path: String,
    history_json: String,
    api_key: String,
    model: String,
    target_window: String,
) -> Result<(), String> {
    let cmd = chat_cmd(
        &app,
        &[
            &message,
            &image_path,
            &history_json,
            &model,
        ],
    )?;

    let (mut rx, child) = cmd
        .env(MIMIR_API_KEY_ENV, &api_key)
        .spawn()
        .map_err(|e| e.to_string())?;

    let window_label = target_window;
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    if let Some(window) = app.get_webview_window(&window_label) {
                        let _ = window.emit("chat-stream-chunk", line.to_string());
                    }
                }
                CommandEvent::Stderr(line_bytes) => {
                    eprintln!("chat stderr: {}", String::from_utf8_lossy(&line_bytes));
                }
                CommandEvent::Terminated(payload) => {
                    println!("chat sidecar exited: {:?}", payload);
                    break;
                }
                _ => {}
            }
        }
        drop(child);
    });
    Ok(())
}
