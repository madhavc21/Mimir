use tauri::AppHandle;

use crate::settings;
use crate::sidecars;

#[tauri::command]
pub async fn stream_from_python(
    app_handle: AppHandle,
    message: String,
    image_path: Option<String>,
    history: Option<serde_json::Value>,
    target_window: Option<String>,
) -> Result<(), String> {
    let store = settings::load_store(&app_handle)?;
    let (provider, api_key) = settings::resolve_provider_and_key(&store)?;
    let model = settings::read_selected_model(&store);
    if !model.starts_with(&format!("{provider}/")) {
        return Err(format!(
            "Selected model {model} does not match provider {provider}."
        ));
    }

    let history_json = serde_json::to_string(&history.unwrap_or(serde_json::json!([])))
        .unwrap_or_else(|_| "[]".to_string());

    let window = target_window.unwrap_or_else(|| "main".to_string());

    sidecars::stream_chat(
        app_handle,
        message,
        image_path.unwrap_or_default(),
        history_json,
        api_key,
        model,
        window,
    )
    .await
}
