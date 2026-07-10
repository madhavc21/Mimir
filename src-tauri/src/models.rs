use tauri::AppHandle;

use crate::settings::{self, ModelInfo};
use crate::sidecars;

#[tauri::command]
pub async fn list_providers(app: AppHandle) -> Result<Vec<String>, String> {
    sidecars::list_providers(&app).await
}

#[tauri::command]
pub async fn list_models(app: AppHandle, provider: Option<String>) -> Result<Vec<ModelInfo>, String> {
    let store = settings::load_store(&app)?;
    let api_key = settings::read_api_key(&store);
    if api_key.trim().is_empty() {
        return Err("No API key configured. Open Mimir Console → Model.".into());
    }
    let provider = provider
        .filter(|p| !p.is_empty())
        .or_else(|| settings::read_selected_provider(&store))
        .ok_or_else(|| {
            "Select a provider in Model settings.".to_string()
        })?;
    sidecars::list_models(&app, &provider, &api_key).await
}
