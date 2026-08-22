/// Chat daemon lifecycle manager.
///
/// Replaces per-request `chat.exe` spawns with a single long-lived daemon
/// process (stdin/stdout JSON protocol). The daemon is warmed on hotkey and
/// kept alive for 1 hour after last use, then killed.
///
/// State machine: Unstarted → Starting → Ready ⇄ Busy → Unstarted (on exit/TTL)
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::{Mutex, Notify};

// ---------------------------------------------------------------------------
// Phase
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
enum Phase {
    Unstarted,
    Starting,
    Ready,
    Busy,
}

// ---------------------------------------------------------------------------
// Pending list RPC
// ---------------------------------------------------------------------------
// Only one list call can be in flight at a time (Console serialises them).
// The reader task resolves this when it sees {"id":"...", "type":"done"}.

struct ListPending {
    id: String,
    // Accumulate the result payload (arrives as {"id":"...", "result":[...]})
    result_json: Option<serde_json::Value>,
    tx: tokio::sync::oneshot::Sender<Result<serde_json::Value, String>>,
}

// ---------------------------------------------------------------------------
// Inner mutable state (Mutex-guarded)
// ---------------------------------------------------------------------------

struct DaemonInner {
    phase: Phase,
    child: Option<CommandChild>,
    last_used: Instant,
    stdout_task: Option<tauri::async_runtime::JoinHandle<()>>,
}

// ---------------------------------------------------------------------------
// ChatDaemon — the public handle stored in Tauri state
// ---------------------------------------------------------------------------

pub struct ChatDaemon {
    inner: Mutex<DaemonInner>,
    /// Notified when phase transitions to Ready (or Unstarted after crash).
    ready_notify: Arc<Notify>,
    next_id: AtomicU64,
    /// Pending list RPC, if any.
    pending_list: Arc<Mutex<Option<ListPending>>>,
}

impl ChatDaemon {
    pub fn new() -> Self {
        ChatDaemon {
            inner: Mutex::new(DaemonInner {
                phase: Phase::Unstarted,
                child: None,
                last_used: Instant::now(),
                stdout_task: None,
            }),
            ready_notify: Arc::new(Notify::new()),
            next_id: AtomicU64::new(1),
            pending_list: Arc::new(Mutex::new(None)),
        }
    }

    fn alloc_id(&self) -> String {
        self.next_id.fetch_add(1, Ordering::Relaxed).to_string()
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /// Fire-and-forget warm — called from hotkey handler, never blocks capture.
    pub fn warm(&self, app: AppHandle) {
        log::info!("[ChatDaemon] warm: triggered from hotkey");
        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            let daemon = app_clone.state::<ChatDaemon>();
            match daemon.ensure_ready(&app_clone).await {
                Ok(()) => log::info!("[ChatDaemon] warm: daemon ready ✓"),
                Err(e) => log::warn!("[ChatDaemon] warm: {e}"),
            }
        });
    }

    /// Wait until phase is Ready (or error if it can't become ready within 5s).
    pub async fn ensure_ready(&self, app: &AppHandle) -> Result<(), String> {
        {
            let mut inner = self.inner.lock().await;
            match inner.phase {
                Phase::Ready | Phase::Busy => {
                    log::debug!("[ChatDaemon] ensure_ready: already {:?} — skipping", inner.phase);
                    return Ok(());
                }
                Phase::Starting => {
                    log::debug!("[ChatDaemon] ensure_ready: Starting — waiting for ready signal");
                    // fall through
                }
                Phase::Unstarted => {
                    log::info!("[ChatDaemon] ensure_ready: Unstarted → spawning daemon");
                    self.start_locked(&mut inner, app)?;
                }
            }
        } // release inner lock before awaiting

        log::debug!("[ChatDaemon] ensure_ready: awaiting notify (30s timeout)");
        match tokio::time::timeout(Duration::from_secs(30), self.ready_notify.notified()).await {
            Ok(()) => {
                let inner = self.inner.lock().await;
                if inner.phase == Phase::Ready {
                    log::info!("[ChatDaemon] ensure_ready: daemon is Ready ✓");
                    Ok(())
                } else {
                    log::error!(
                        "[ChatDaemon] ensure_ready: notified but phase={:?}",
                        inner.phase
                    );
                    Err("Chat sidecar exited before becoming ready".into())
                }
            }
            Err(_) => {
                log::error!("[ChatDaemon] ensure_ready: timed out after 30s");
                Err("Timed out waiting for chat sidecar to become ready".into())
            }
        }
    }

    /// Send a stream RPC. Returns immediately; tokens arrive as `chat-stream-chunk` events.
    pub async fn rpc_stream(
        &self,
        app: &AppHandle,
        message: String,
        image_path: String,
        history_json: String,
        api_key: String,
        model: String,
        target_window: String,
    ) -> Result<(), String> {
        self.ensure_ready(app).await?;

        let mut inner = self.inner.lock().await;
        if inner.phase == Phase::Busy {
            return Err("Still replying — wait for the current stream to finish".into());
        }
        if inner.phase != Phase::Ready {
            return Err("Chat sidecar not ready".into());
        }

        let history: serde_json::Value =
            serde_json::from_str(&history_json).unwrap_or(serde_json::json!([]));
        let req_id = self.alloc_id();
        let req = serde_json::json!({
            "id": req_id,
            "op": "stream",
            "message": message,
            "image_path": image_path,
            "history": history,
            "model": model,
            "api_key": api_key,
            "target_window": target_window,
        });

        log::info!(
            "[ChatDaemon] rpc_stream: id={req_id} model={model} window={target_window}"
        );
        self.write_req(&mut inner, &req)?;
        inner.phase = Phase::Busy;
        inner.last_used = Instant::now();
        Ok(())
    }

    /// Send a list_providers RPC and await the JSON result.
    pub async fn rpc_list_providers(
        &self,
        app: &AppHandle,
    ) -> Result<Vec<String>, String> {
        self.ensure_ready(app).await?;

        let req_id = self.alloc_id();
        let req = serde_json::json!({"id": req_id, "op": "list_providers"});
        log::info!("[ChatDaemon] rpc_list_providers: id={req_id}");

        let (tx, rx) = tokio::sync::oneshot::channel();
        {
            *self.pending_list.lock().await = Some(ListPending {
                id: req_id.clone(),
                result_json: None,
                tx,
            });
            let mut inner = self.inner.lock().await;
            self.write_req(&mut inner, &req)?;
            inner.last_used = Instant::now();
        }

        let raw = tokio::time::timeout(Duration::from_secs(30), rx)
            .await
            .map_err(|_| "list_providers timed out".to_string())?
            .map_err(|_| "list_providers channel closed".to_string())??;

        serde_json::from_value(raw).map_err(|e| format!("Invalid provider list JSON: {e}"))
    }

    /// Send a list_models RPC and await the result.
    pub async fn rpc_list_models(
        &self,
        app: &AppHandle,
        provider: String,
        api_key: String,
    ) -> Result<Vec<crate::settings::ModelInfo>, String> {
        self.ensure_ready(app).await?;

        let req_id = self.alloc_id();
        let req = serde_json::json!({
            "id": req_id,
            "op": "list_models",
            "provider": provider,
            "api_key": api_key,
        });
        log::info!("[ChatDaemon] rpc_list_models: id={req_id} provider={provider}");

        let (tx, rx) = tokio::sync::oneshot::channel();
        {
            *self.pending_list.lock().await = Some(ListPending {
                id: req_id.clone(),
                result_json: None,
                tx,
            });
            let mut inner = self.inner.lock().await;
            self.write_req(&mut inner, &req)?;
            inner.last_used = Instant::now();
        }

        let raw = tokio::time::timeout(Duration::from_secs(30), rx)
            .await
            .map_err(|_| "list_models timed out".to_string())?
            .map_err(|_| "list_models channel closed".to_string())??;

        serde_json::from_value(raw).map_err(|e| format!("Invalid model list JSON: {e}"))
    }

    /// Kill daemon if idle longer than `ttl`. Called every 60s from background tick.
    pub async fn kill_if_idle(&self, ttl: Duration) {
        let mut inner = self.inner.lock().await;
        if inner.phase == Phase::Unstarted {
            return;
        }
        let idle = inner.last_used.elapsed();
        if idle > ttl {
            log::info!(
                "[ChatDaemon] kill_if_idle: idle {:.0?} > TTL {:.0?} — killing",
                idle,
                ttl
            );
            Self::kill_inner(&mut inner);
        }
    }

    /// Kill daemon on app quit.
    pub async fn shutdown(&self) {
        let mut inner = self.inner.lock().await;
        if inner.phase != Phase::Unstarted {
            log::info!("[ChatDaemon] shutdown: killing daemon");
            Self::kill_inner(&mut inner);
        }
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /// Spawn the daemon child and start the stdout reader task.
    /// Must be called with `inner` locked.
    fn start_locked(&self, inner: &mut DaemonInner, app: &AppHandle) -> Result<(), String> {
        let (mut rx, child) = chat_cmd_daemon(app)?
            .spawn()
            .map_err(|e| {
                log::error!("[ChatDaemon] spawn failed: {e}");
                e.to_string()
            })?;

        log::info!("[ChatDaemon] daemon process spawned — waiting for ready handshake");
        inner.phase = Phase::Starting;
        inner.child = Some(child);

        let app_clone = app.clone();
        let notify = self.ready_notify.clone();
        let pending_list = self.pending_list.clone();

        let handle = tauri::async_runtime::spawn(async move {
            let daemon = app_clone.state::<ChatDaemon>();

            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        let raw = String::from_utf8_lossy(&bytes);
                        let line = raw.trim();
                        if line.is_empty() {
                            continue;
                        }
                        log::debug!("[ChatDaemon] stdout ← {line}");

                        let Ok(val) = serde_json::from_str::<serde_json::Value>(line) else {
                            log::warn!("[ChatDaemon] non-JSON stdout: {line}");
                            continue;
                        };

                        let msg_type = val["type"].as_str().unwrap_or("");
                        let status = val["status"].as_str().unwrap_or("");
                        let msg_id = val["id"].as_str().unwrap_or("").to_string();

                        // ── ready handshake ──────────────────────────────────
                        if msg_type == "ready" {
                            log::info!("[ChatDaemon] reader: ready handshake received ✓");
                            daemon.inner.lock().await.phase = Phase::Ready;
                            notify.notify_waiters();
                            continue;
                        }

                        // ── error ────────────────────────────────────────────
                        if status == "error" {
                            let err_msg = val["message"].as_str().unwrap_or("unknown error");
                            log::error!("[ChatDaemon] reader: error id={msg_id}: {err_msg}");

                            // resolve pending list if id matches
                            let mut pl = pending_list.lock().await;
                            if pl.as_ref().map(|p| p.id == msg_id || msg_id.is_empty()).unwrap_or(false) {
                                if let Some(p) = pl.take() {
                                    let _ = p.tx.send(Err(err_msg.to_string()));
                                }
                            }
                            drop(pl);

                            // emit error chunk so UI error handling activates
                            app_clone.emit("chat-stream-chunk", line.to_string()).ok();

                            // Busy → Ready
                            let mut inner = daemon.inner.lock().await;
                            if inner.phase == Phase::Busy {
                                inner.phase = Phase::Ready;
                                log::debug!("[ChatDaemon] reader: Busy → Ready (error)");
                            }
                            continue;
                        }

                        // ── done ─────────────────────────────────────────────
                        if msg_type == "done" {
                            log::info!("[ChatDaemon] reader: done id={msg_id}");

                            // resolve pending list
                            let mut pl = pending_list.lock().await;
                            if pl.as_ref().map(|p| p.id == msg_id).unwrap_or(false) {
                                if let Some(p) = pl.take() {
                                    let result = p.result_json.ok_or_else(|| {
                                        "list RPC returned done without result".to_string()
                                    });
                                    let _ = p.tx.send(result);
                                }
                            }
                            drop(pl);

                            // stream done: Busy → Ready
                            let mut inner = daemon.inner.lock().await;
                            if inner.phase == Phase::Busy {
                                inner.phase = Phase::Ready;
                                log::debug!("[ChatDaemon] reader: Busy → Ready (done)");
                            }
                            continue;
                        }

                        // ── list result line ─────────────────────────────────
                        if val.get("result").is_some() {
                            let mut pl = pending_list.lock().await;
                            if pl.as_ref().map(|p| p.id == msg_id).unwrap_or(false) {
                                if let Some(p) = pl.as_mut() {
                                    p.result_json = val.get("result").cloned();
                                }
                            }
                            continue;
                        }

                        // ── stream token ─────────────────────────────────────
                        if val.get("token").is_some() {
                            app_clone.emit("chat-stream-chunk", line.to_string()).ok();
                            continue;
                        }

                        log::warn!("[ChatDaemon] reader: unhandled stdout message: {line}");
                    }

                    CommandEvent::Stderr(bytes) => {
                        eprintln!(
                            "[ChatDaemon] daemon stderr: {}",
                            String::from_utf8_lossy(&bytes)
                        );
                    }

                    CommandEvent::Terminated(payload) => {
                        log::warn!("[ChatDaemon] daemon process terminated: {:?}", payload);
                        {
                            let mut inner = daemon.inner.lock().await;
                            inner.phase = Phase::Unstarted;
                            inner.child = None;
                            // stdout_task cleared by kill_inner; here we can't
                            // self-remove since we're inside the task.
                        }
                        // wake any ensure_ready waiters
                        notify.notify_waiters();
                        // reject pending list if any
                        let mut pl = pending_list.lock().await;
                        if let Some(p) = pl.take() {
                            let _ = p.tx.send(Err("Chat sidecar exited unexpectedly".into()));
                        }
                        break;
                    }

                    _ => {}
                }
            }
            log::debug!("[ChatDaemon] reader task exiting");
        });

        inner.stdout_task = Some(handle);
        Ok(())
    }

    fn write_req(&self, inner: &mut DaemonInner, req: &serde_json::Value) -> Result<(), String> {
        let child = inner.child.as_mut().ok_or("Daemon child not running")?;
        let mut line = serde_json::to_string(req).map_err(|e| e.to_string())?;
        line.push('\n');
        log::debug!("[ChatDaemon] stdin → {}", line.trim_end());
        child.write(line.as_bytes()).map_err(|e| {
            log::error!("[ChatDaemon] stdin write failed: {e}");
            e.to_string()
        })
    }

    fn kill_inner(inner: &mut DaemonInner) {
        if let Some(task) = inner.stdout_task.take() {
            task.abort();
        }
        drop(inner.child.take()); // CommandChild kills on drop
        inner.phase = Phase::Unstarted;
    }
}

// ---------------------------------------------------------------------------
// Command builder — dev uses .venv python, prod uses chat.exe sidecar
// ---------------------------------------------------------------------------

fn chat_cmd_daemon(app: &AppHandle) -> Result<tauri_plugin_shell::process::Command, String> {
    if cfg!(debug_assertions) {
        Ok(app
            .shell()
            .command("../sidecars/.venv/Scripts/python")
            .args(["../sidecars/chat.py", "--daemon"]))
    } else {
        Ok(app
            .shell()
            .sidecar("chat")
            .map_err(|e| e.to_string())?
            .args(["--daemon"]))
    }
}
