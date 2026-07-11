use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadMeta {
    pub id: String,
    pub name: String,
    #[serde(rename = "thumbnailPath", default, skip_serializing_if = "Option::is_none")]
    pub thumbnail_path: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredMessage {
    pub role: String,
    pub content: String,
    #[serde(rename = "imagePath", skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Thread {
    pub id: String,
    pub name: String,
    #[serde(rename = "thumbnailPath", default, skip_serializing_if = "Option::is_none")]
    pub thumbnail_path: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    pub messages: Vec<StoredMessage>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct ThreadIndex {
    #[serde(rename = "nextChatNum", default)]
    next_chat_num: u32,
    threads: Vec<ThreadMeta>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ThreadFile {
    id: String,
    messages: Vec<StoredMessage>,
}

fn now_ms() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

fn new_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{millis:x}")
}

fn chats_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("chats");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn read_index(dir: &PathBuf) -> Result<ThreadIndex, String> {
    let path = dir.join("index.json");
    if !path.exists() {
        return Ok(ThreadIndex::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn write_index(dir: &PathBuf, index: &ThreadIndex) -> Result<(), String> {
    let path = dir.join("index.json");
    let raw = serde_json::to_string_pretty(index).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_threads(app: AppHandle) -> Result<Vec<ThreadMeta>, String> {
    let dir = chats_dir(&app)?;
    let index = read_index(&dir)?;
    Ok(index.threads)
}

#[tauri::command]
pub fn load_thread(app: AppHandle, id: String) -> Result<Thread, String> {
    let dir = chats_dir(&app)?;
    let index = read_index(&dir)?;
    let meta = index
        .threads
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| format!("thread not found: {id}"))?
        .clone();

    let path = dir.join(format!("{id}.json"));
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let file: ThreadFile = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    Ok(Thread {
        id: meta.id,
        name: meta.name,
        thumbnail_path: meta.thumbnail_path,
        created_at: meta.created_at,
        updated_at: meta.updated_at,
        messages: file.messages,
    })
}

#[tauri::command]
pub fn create_thread(
    app: AppHandle,
    name: Option<String>,
    thumbnail_path: Option<String>,
) -> Result<ThreadMeta, String> {
    let dir = chats_dir(&app)?;
    let mut index = read_index(&dir)?;

    index.next_chat_num += 1;
    let now = now_ms();
    let display_name = name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| format!("chat-{}", index.next_chat_num));
    let thumb = thumbnail_path
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());
    let meta = ThreadMeta {
        id: new_id(),
        name: display_name,
        thumbnail_path: thumb,
        created_at: now.clone(),
        updated_at: now,
    };

    let file = ThreadFile {
        id: meta.id.clone(),
        messages: vec![],
    };
    fs::write(
        dir.join(format!("{}.json", meta.id)),
        serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    index.threads.push(meta.clone());
    write_index(&dir, &index)?;
    Ok(meta)
}

#[tauri::command]
pub fn save_thread_messages(
    app: AppHandle,
    id: String,
    messages: Vec<StoredMessage>,
) -> Result<(), String> {
    let dir = chats_dir(&app)?;
    let path = dir.join(format!("{id}.json"));

    let file = ThreadFile {
        id: id.clone(),
        messages,
    };
    fs::write(
        &path,
        serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let mut index = read_index(&dir)?;
    let now = now_ms();
    if let Some(thread) = index.threads.iter_mut().find(|t| t.id == id) {
        thread.updated_at = now;
    }
    write_index(&dir, &index)?;
    Ok(())
}
