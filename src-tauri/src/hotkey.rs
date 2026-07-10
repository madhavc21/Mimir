use std::str::FromStr;

use tauri::AppHandle;
use tauri_plugin_global_shortcut::Shortcut;
use crate::settings;

pub const DEFAULT_HOTKEY: &str = "Ctrl+Shift+E";

pub fn normalize_hotkey(raw: &str) -> String {
    raw.split('+')
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .map(|part| {
            match part.to_ascii_lowercase().as_str() {
                "control" => "Ctrl".to_string(),
                "command" | "cmd" => "Cmd".to_string(),
                "option" => "Alt".to_string(),
                key if key.len() == 1 => key.to_uppercase(),
                _ => part.to_string(),
            }
        })
        .collect::<Vec<_>>()
        .join("+")
}

pub fn parse_hotkey(raw: &str) -> Result<Shortcut, String> {
    let normalized = normalize_hotkey(raw);
    Shortcut::from_str(&normalized).map_err(|e| e.to_string())
}

pub fn load_hotkey_from_store(app: &AppHandle) -> Result<Shortcut, String> {
    let store = settings::load_store(app)?;
    let hotkey = store
        .get("hotkey")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| DEFAULT_HOTKEY.to_string());
    parse_hotkey(&hotkey)
}

pub fn save_hotkey_to_store(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let store = settings::load_store(app)?;
    store.set("hotkey", serde_json::json!(normalize_hotkey(hotkey)));
    store.save().map_err(|e| e.to_string())
}

/// User-facing message when Windows RegisterHotKey rejects a duplicate (ERROR 1409).
pub fn registration_error_message(err: impl std::fmt::Display) -> String {
    let msg = err.to_string();
    if msg.contains("Already registered") || msg.contains("ERROR_HOTKEY_ALREADY_REGISTERED") {
        "That shortcut is already registered by another application. Pick a different combination."
            .to_string()
    } else {
        format!("Could not register shortcut: {msg}")
    }
}
