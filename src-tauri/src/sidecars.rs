use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

fn is_dev() -> bool {
    cfg!(debug_assertions)
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

pub async fn stream_chat(
    app: AppHandle,
    message: String,
    image_path: String,
    history_json: String,
    api_key: String,
    model: String,
) -> Result<(), String> {
    let cmd = if is_dev() {
        // Use local venv incase of dev environment
        app.shell()
            .command("../sidecars/.venv/Scripts/python")
            .args([
                "../sidecars/chat.py",
                &message,
                &image_path,
                &history_json,
                &model,
            ])
    } else {
        // Use pre-built binaries in production
        app.shell()
            .sidecar("chat")
            .map_err(|e| e.to_string())?
            .args([&message, &image_path, &history_json, &model])
    };

    let (mut rx, child) = cmd
        .env("GEMINI_API_KEY", &api_key)
        .spawn()
        .map_err(|e| e.to_string())?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line_bytes) => {
                    let line = String::from_utf8_lossy(&line_bytes);
                    if let Some(window) = app.get_webview_window("main") {
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