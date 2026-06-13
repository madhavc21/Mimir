use tauri_plugin_store::StoreExt;
use tauri::AppHandle;

use crate::sidecars;

#[tauri::command]
pub async fn stream_from_python(
    app_handle: AppHandle, 
    message: String, 
    image_path: Option<String>, 
    history: Option<serde_json::Value>
) -> Result<(), String> {
    
    let store = app_handle.store("settings.json").map_err(|e| e.to_string())?;
    store.reload().map_err(|e| e.to_string())?;

    let api_key = store
        .get("geminiApiKey")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    
    if api_key.is_empty() {
        return Err(
            "No Gemini API key configured. Open Settings (gear icon) and paste your key.".into(),
        );
    }
    // Safely convert the history Vector into a JSON string for Python
    let history_json = serde_json::to_string(&history.unwrap_or(serde_json::json!([])))
        .unwrap_or_else(|_| "[]".to_string());
    
    sidecars::stream_chat(
        app_handle,
        message,
        image_path.unwrap_or_default(),
        history_json,
        api_key
    )
    .await
}