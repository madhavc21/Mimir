use std::io::ErrorKind;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_store::{Error as StoreError, StoreExt};

pub const DEFAULT_MODEL: &str = "gemini/gemini-2.5-flash-lite";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    #[serde(rename = "supportsVision")]
    pub supports_vision: bool,
}

fn reload_store_if_exists(store: &tauri_plugin_store::Store<tauri::Wry>) -> Result<(), String> {
    match store.reload() {
        Ok(()) => Ok(()),
        // ponytail: fresh install has no settings.json yet; defaults apply until first save
        Err(StoreError::Io(e)) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn load_store(app: &AppHandle) -> Result<Arc<tauri_plugin_store::Store<tauri::Wry>>, String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    reload_store_if_exists(&store)?;
    Ok(store)
}

pub fn read_api_key(store: &Arc<tauri_plugin_store::Store<tauri::Wry>>) -> String {
    store
        .get("apiKey")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default()
}

pub fn read_selected_provider(store: &Arc<tauri_plugin_store::Store<tauri::Wry>>) -> Option<String> {
    store
        .get("selectedProvider")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .filter(|p| !p.is_empty())
}

pub fn read_selected_model(store: &Arc<tauri_plugin_store::Store<tauri::Wry>>) -> String {
    store
        .get("selectedModel")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| DEFAULT_MODEL.to_string())
}

pub fn resolve_provider_and_key(
    store: &Arc<tauri_plugin_store::Store<tauri::Wry>>,
) -> Result<(String, String), String> {
    let api_key = read_api_key(store);
    if api_key.trim().is_empty() {
        return Err("No API key configured. Open Mimir Console → Model.".into());
    }

    let provider = read_selected_provider(store).ok_or_else(|| {
        "Select a provider in Model settings (or paste a recognized Gemini/OpenAI/Anthropic/xAI key)."
            .to_string()
    })?;

    Ok((provider, api_key))
}
