use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_store::StoreExt;

mod sidecars;
mod stream;
mod chats;
mod settings;

#[cfg(target_os = "windows")]
use window_vibrancy::apply_acrylic;

pub struct ListenerState {
    pub active: AtomicBool,
    pub capture_busy: AtomicBool,
    pub shortcut: Shortcut,
}

pub struct CardState {
    pub locked: AtomicBool,
    pub expanded: AtomicBool,
    normal_geometry: Mutex<Option<WindowGeometry>>,
}

#[derive(Clone, Copy)]
struct WindowGeometry {
    width: f64,
    height: f64,
    x: i32,
    y: i32,
}

const DEFAULT_CARD_WIDTH: f64 = 260.0;
const DEFAULT_CARD_HEIGHT: f64 = 380.0;

fn reset_card_session(app: &tauri::AppHandle, window: Option<&tauri::Window>) {
    let card = app.state::<CardState>();
    card.locked.store(false, Ordering::SeqCst);
    if card.expanded.swap(false, Ordering::SeqCst) {
        if let Some(window) = window {
            if let Ok(guard) = card.normal_geometry.lock() {
                if let Some(geometry) = *guard {
                    let _ = window.set_size(LogicalSize::new(geometry.width, geometry.height));
                    let _ = window.set_position(PhysicalPosition::new(geometry.x, geometry.y));
                }
            }
        }
    }

    if let Some(window) = window {
        let _ = window.set_always_on_top(false);
        let _ = window.emit("session-reset", ());
        let _ = window.emit("card-lock-changed", false);
        let _ = window.emit("card-expanded-changed", false);
    }
}

fn ensure_main_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("main") {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Mimir")
        .inner_size(DEFAULT_CARD_WIDTH, DEFAULT_CARD_HEIGHT)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .maximizable(false)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        let _ = apply_acrylic(&window, Some((15, 15, 22, 80)));
    }

    Ok(window)
}

#[tauri::command]
fn open_console(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_always_on_top(false);
        let _ = main.hide();
    }

    let win = match app.get_webview_window("console") {
        Some(w) => w,
        None => WebviewWindowBuilder::new(&app, "console", WebviewUrl::App("console.html".into()))
            .title("Mimir")
            .inner_size(680.0, 520.0)
            .resizable(true)
            .decorations(true)
            .build()
            .map_err(|e| e.to_string())?,
    };

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

#[tauri::command]
fn set_card_locked(
    app: tauri::AppHandle,
    state: State<'_, CardState>,
    locked: bool,
) -> Result<(), String> {
    state.locked.store(locked, Ordering::SeqCst);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(locked);
        let _ = window.emit("card-lock-changed", locked);
    }
    Ok(())
}

#[tauri::command]
fn get_card_state(state: State<'_, CardState>) -> Result<(bool, bool), String> {
    Ok((
        state.locked.load(Ordering::SeqCst),
        state.expanded.load(Ordering::SeqCst),
    ))
}

#[tauri::command]
fn toggle_card_expanded(
    app: tauri::AppHandle,
    state: State<'_, CardState>,
) -> Result<bool, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let expanding = !state.expanded.load(Ordering::SeqCst);

    if expanding {
        let size = window
            .outer_size()
            .map_err(|e| e.to_string())?;
        let pos = window
            .outer_position()
            .map_err(|e| e.to_string())?;
        *state.normal_geometry.lock().map_err(|e| e.to_string())? = Some(WindowGeometry {
            width: size.width as f64,
            height: size.height as f64,
            x: pos.x,
            y: pos.y,
        });

        let monitor = window
            .current_monitor()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "no monitor".to_string())?;
        let mon_pos = monitor.position();
        let mon_size = monitor.size();
        window
            .set_size(PhysicalSize::new(mon_size.width, mon_size.height))
            .map_err(|e| e.to_string())?;
        window
            .set_position(PhysicalPosition::new(mon_pos.x, mon_pos.y))
            .map_err(|e| e.to_string())?;
        state.expanded.store(true, Ordering::SeqCst);
    } else {
        let geometry = state
            .normal_geometry
            .lock()
            .map_err(|e| e.to_string())?
            .unwrap_or(WindowGeometry {
                width: DEFAULT_CARD_WIDTH,
                height: DEFAULT_CARD_HEIGHT,
                x: 0,
                y: 0,
            });
        window
            .set_size(LogicalSize::new(geometry.width, geometry.height))
            .map_err(|e| e.to_string())?;
        window
            .set_position(PhysicalPosition::new(geometry.x, geometry.y))
            .map_err(|e| e.to_string())?;
        state.expanded.store(false, Ordering::SeqCst);
    }

    let expanded = state.expanded.load(Ordering::SeqCst);
    let _ = window.emit("card-expanded-changed", expanded);
    Ok(expanded)
}

struct CapturBusyGuard<'a>(&'a AtomicBool);
impl Drop for CapturBusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

async fn handle_hotkey_capture(app: tauri::AppHandle) {
    let state = app.state::<ListenerState>();
    let _guard = CapturBusyGuard(&state.capture_busy);
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
    let window = match ensure_main_window(&app) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("failed to open main window: {e}");
            return;
        }
    };
    let card = app.state::<CardState>();
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
    if !card.expanded.load(Ordering::SeqCst) {
        let _ = window.set_size(LogicalSize::new(DEFAULT_CARD_WIDTH, DEFAULT_CARD_HEIGHT));
    }
    let _ = window.set_always_on_top(true);
    let _ = window.show();
    let _ = window.set_focus();
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
                    if state.capture_busy.swap(true, Ordering::SeqCst) {
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
            if window.label() == "console" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
                return;
            }
            if window.label() == "main" {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let app = window.app_handle().clone();
                        reset_card_session(&app, Some(window));
                        let _ = window.hide();
                    }
                    WindowEvent::Destroyed => {
                        let app = window.app_handle().clone();
                        reset_card_session(&app, None);
                    }
                    WindowEvent::Focused(false) => {
                        let app = window.app_handle().clone();
                        let win = window.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(std::time::Duration::from_millis(150));
                            let locked = app.state::<CardState>().locked.load(Ordering::SeqCst);
                            if locked {
                                return;
                            }
                            if !win.is_focused().unwrap_or(true) {
                                reset_card_session(&app, Some(&win));
                                let _ = win.hide();
                            }
                        });
                    }
                    _ => {}
                }
            }
        })
        .manage(ListenerState {
            active: AtomicBool::new(true),
            capture_busy: AtomicBool::new(false),
            shortcut: shortcut.clone(),
        })
        .manage(CardState {
            locked: AtomicBool::new(false),
            expanded: AtomicBool::new(false),
            normal_geometry: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            stream::stream_from_python,
            chats::list_threads,
            chats::load_thread,
            chats::create_thread,
            chats::save_thread_messages,
            settings::get_api_key,
            open_console,
            quit_app,
            get_listener_status,
            start_listener,
            stop_listener,
            set_autostart,
            is_autostart_enabled,
            set_card_locked,
            get_card_state,
            toggle_card_expanded,
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
