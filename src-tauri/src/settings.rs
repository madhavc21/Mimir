use tauri_plugin_store::StoreExt;

#[tauri::command]
pub fn get_api_key(app: tauri::AppHandle) -> String {
    let store = app.store("settings.json").unwrap();
    store.get("geminiApiKey")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_default()
}