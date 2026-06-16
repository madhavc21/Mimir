use std::sync::atomic::{AtomicBool, Ordering};

use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri::{Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_store::StoreExt;

mod sidecars;
mod chat;
mod settings;

#[cfg(target_os = "windows")]
use window_vibrancy::apply_acrylic;

pub struct ListenerState {
    pub active: AtomicBool,
    pub shortcut: Shortcut,
}

#[tauri::command]
fn open_console(app: tauri::AppHandle) -> Result<(), String> {
    // ponytail: main is alwaysOnTop — must drop it before console can appear on top
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_always_on_top(false);
        let _ = main.hide();
    }
    let win = app
        .get_webview_window("console")
        .ok_or_else(|| "Console window not found".to_string())?;
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn get_listener_status(state: State<'_, ListenerState>) -> bool {
    state.active.load(Ordering::SeqCst)
}

#[tauri::command]
fn start_listener(app: tauri::AppHandle, state: State<'_, ListenerState>) -> Result<bool, String> {
    if state.active.load(Ordering::SeqCst) {
        return Ok(true);
    }
    app.global_shortcut()
        .register(state.shortcut.clone())
        .map_err(|e| e.to_string())?;
    state.active.store(true, Ordering::SeqCst);
    Ok(true)
}

#[tauri::command]
fn stop_listener(app: tauri::AppHandle, state: State<'_, ListenerState>) -> Result<bool, String> {
    if !state.active.load(Ordering::SeqCst) {
        return Ok(false);
    }
    app.global_shortcut()
        .unregister(state.shortcut.clone())
        .map_err(|e| e.to_string())?;
    state.active.store(false, Ordering::SeqCst);
    Ok(false)
}

#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    if enabled {
        app.autolaunch().enable().map_err(|e| e.to_string())?;
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())?;
    }
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    store.set("autostart", serde_json::json!(enabled));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn is_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

async fn handle_hotkey_capture(app: tauri::AppHandle) {
    let result = match sidecars::run_capture(&app).await {
        Ok(output) => String::from_utf8_lossy(&output.stdout).to_string(),
        Err(e) => format!(r#"{{"status":"error","message":"{}"}}"#, e),
    };
    let mut command = "capture-text";
    println!("{}", result);

    let parsed: serde_json::Value = serde_json::from_str(&result).unwrap_or_else(|err| {
        eprintln!("Failed to parse sidecar output: {}. Raw: {}", err, result);
        serde_json::json!({
            "status": "error",
            "message": "Failed to parse sidecar output"
        })
    });

    if parsed.get("type").and_then(|val| val.as_str()) == Some("image") {
        println!("Captured screen");
        command = "capture-screen";
    }
    if let Some(window) = app.get_webview_window("main") {
        let cursor_pos = window
            .cursor_position()
            .unwrap_or(tauri::PhysicalPosition::new(0.0, 0.0));
        if let Ok(Some(monitor)) = window.current_monitor() {
            let monitor_pos = monitor.position();
            let monitor_size = monitor.size();
            let win_size = window
                .outer_size()
                .unwrap_or(tauri::PhysicalSize::new(260, 380));
            let max_x = monitor_pos.x + monitor_size.width as i32 - win_size.width as i32;
            let max_y = monitor_pos.y + monitor_size.height as i32 - win_size.height as i32;
            let x = (cursor_pos.x as i32).clamp(monitor_pos.x, max_x);
            let y = (cursor_pos.y as i32).clamp(monitor_pos.y, max_y);
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        }
        let _ = window.emit(command, result);
        let _ = window.set_size(tauri::LogicalSize::new(260.0, 380.0));
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyE);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app_handle, _shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let state = app_handle.state::<ListenerState>();
                    if !state.active.load(Ordering::SeqCst) {
                        return;
                    }
                    println!("Hotkey triggered, spawning python sidecar to capture");
                    let app = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        handle_hotkey_capture(app).await;
                    });
                })
                .build(),
        )
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::Focused(false) = event {
                    let win = window.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(150));
                        if !win.is_focused().unwrap_or(true) {
                            let _ = win.emit("session-reset", ());
                            let _ = win.hide();
                        }
                    });
                }
            }
        })
        .manage(ListenerState {
            active: AtomicBool::new(true),
            shortcut: shortcut.clone(),
        })
        .invoke_handler(tauri::generate_handler![
            chat::stream_from_python,
            settings::get_api_key,
            open_console,
            quit_app,
            get_listener_status,
            start_listener,
            stop_listener,
            set_autostart,
            is_autostart_enabled,
        ])
        .setup(move |app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let _ = app.global_shortcut().register(shortcut);

            #[cfg(target_os = "windows")]
            {
                let window = app.get_webview_window("main").unwrap();
                let _ = apply_acrylic(&window, Some((15, 15, 22, 80)));
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
