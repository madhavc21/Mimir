use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState, Modifiers, Code};
use tauri::{Manager, Emitter, WindowEvent};

mod sidecars;
mod chat;
mod settings;

#[cfg(target_os = "windows")]
use window_vibrancy::apply_acrylic;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let shortcut = Shortcut::new(
    Some(Modifiers::CONTROL | Modifiers::SHIFT),
    Code::KeyE,
  );

  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_store::Builder::new().build())
    // Register the command so Tauri knows how to route incoming JS invokes to this function
    .plugin(
      tauri_plugin_global_shortcut::Builder::new()
      .with_handler(move |app_handle, _shortcut, event| {
        if event.state() == ShortcutState::Pressed {
          println!("Hotkey triggered, spawning python sidecar to capture");
          let app = app_handle.clone();
          tauri::async_runtime::spawn(async move {
            let result = match sidecars::run_capture(&app).await {
              Ok(output) => String::from_utf8_lossy(&output.stdout).to_string(),
              Err(e) => format!(r#"{{"status":"error","message":"{}"}}"#, e),
            };
            let mut command = "capture-text";
            println!("{}",result);
            
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
              // Retreive current cursor position (physical coordinates)
              let cursor_pos = window.cursor_position().unwrap_or(tauri::PhysicalPosition::new(0.0, 0.0));
              // Move window to cursor position
              if let Ok(Some(monitor)) = window.current_monitor() {
                let monitor_pos = monitor.position(); // top-left of current monitor
                let monitor_size = monitor.size();  // monitor dimensions (PhysicalSize)
                let win_size = window.outer_size().unwrap_or(tauri::PhysicalSize::new(260, 380));
                // Calculate the maximum x/y so the window stays fully on-screen
                let max_x = monitor_pos.x + monitor_size.width as i32 - win_size.width as i32;
                let max_y = monitor_pos.y + monitor_size.height as i32 - win_size.height as i32;
                
                // Clamp cursor position within bounds
                let x = (cursor_pos.x as i32).clamp(monitor_pos.x, max_x);
                let y = (cursor_pos.y as i32).clamp(monitor_pos.y, max_y);

                let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
              }
              // Emit event to React with the captured text             
              let _ = window.emit(command, result);
              // Reveal and focus the window
              let _ = window.set_size(tauri::LogicalSize::new(260.0, 380.0)); // Reset using LogicalSize
              let _ = window.show();
              let _ = window.set_focus();
            } 
          });
        }
      })
      .build()
    )
    // Automatically hide the window when it loses focus (debounced to
    // avoid false triggers during drag / resize on Windows)
    .on_window_event(|window, event| {
      if window.label() == "main" {
        if let WindowEvent::Focused(false) = event {
          // Windows briefly defocuses during the drag/resize handoff, so we delay
          // hiding the window to avoid false triggers
          let win = window.clone();
          std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            // Only hide if the window is still unfocused after the delay
            if !win.is_focused().unwrap_or(true) {
              let _ = win.emit("session-reset", ());
              let _ = win.hide();
            }
          });
        }
      }
    })
    .invoke_handler(tauri::generate_handler![
      chat::stream_from_python,
      settings::get_api_key
    ])
    .setup(move |app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // 2. Register shortcut during boot setup
      let _ = app.global_shortcut().register(shortcut);

      // Apply native Acrylic background blur on Windows
      #[cfg(target_os = "windows")]
      {
        let window = app.get_webview_window("main").unwrap();
        // Color format: Some((R, G, B, A)) — lower A = more transparent frosted glass
        let _ = apply_acrylic(&window, Some((15, 15, 22, 80)));
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
