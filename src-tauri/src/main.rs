// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

// ─── Backend state ────────────────────────────────────────────────────────────

struct BackendState {
    process:  Mutex<Option<Child>>,
    /// Chemin du log stderr backend (diagnostic)
    log_path: Mutex<Option<PathBuf>>,
}

fn kill_backend(state: &BackendState) {
    if let Ok(mut guard) = state.process.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("himyc_config.json"))
        .map_err(|e| format!("app_data_dir: {}", e))
}

fn log_path_for(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|p| p.join("backend.log"))
}

fn read_project_path(app: &AppHandle) -> Option<String> {
    let cfg = config_path(app).ok()?;
    let content = std::fs::read_to_string(cfg).ok()?;
    let val: serde_json::Value = serde_json::from_str(&content).ok()?;
    val["project_path"].as_str().map(|s| s.to_string())
}

fn write_project_path(app: &AppHandle, path: &str) -> Result<(), String> {
    let cfg = config_path(app)?;
    if let Some(parent) = cfg.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create_dir_all: {}", e))?;
    }
    std::fs::write(&cfg, serde_json::json!({ "project_path": path }).to_string())
        .map_err(|e| format!("write config: {}", e))
}

// ─── Python discovery ─────────────────────────────────────────────────────────

/// Cherche python3 via un login shell (PATH complet : pyenv, brew, conda…).
fn find_python_via_login_shell() -> Option<String> {
    for shell in ["/bin/zsh", "/bin/bash"] {
        if let Ok(out) = Command::new(shell)
            .args(["-lc", "which python3 2>/dev/null || which python 2>/dev/null"])
            .output()
        {
            if out.status.success() {
                let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !p.is_empty() { return Some(p); }
            }
        }
    }
    None
}

fn open_log(log_path: Option<&PathBuf>) -> Stdio {
    log_path
        .and_then(|p| {
            if let Some(parent) = p.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::OpenOptions::new()
                .create(true).write(true).truncate(true)
                .open(p).ok()
        })
        .map(Stdio::from)
        .unwrap_or_else(Stdio::null)
}

fn spawn_uvicorn(project_path: &str, log_path: Option<&PathBuf>) -> Result<Child, String> {
    let mut candidates: Vec<String> = Vec::new();
    if let Some(p) = find_python_via_login_shell() {
        candidates.push(p);
    }
    candidates.extend([
        "/opt/homebrew/bin/python3".into(),
        "/usr/local/bin/python3".into(),
        "python3".into(),
        "python".into(),
    ]);

    let mut errors: Vec<String> = Vec::new();
    for candidate in &candidates {
        let stderr = open_log(log_path);
        match Command::new(candidate)
            .args([
                "-m", "uvicorn",
                "howimetyourcorpus.api.server:app",
                "--host", "127.0.0.1",
                "--port", "8765",
                "--no-access-log",
            ])
            .env("HIMYC_PROJECT_PATH", project_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(stderr)
            .spawn()
        {
            Ok(child) => {
                if let Some(p) = log_path {
                    let header = format!("[HIMYC] Démarré avec : {}\n", candidate);
                    let _ = std::fs::write(p, header);
                }
                return Ok(child);
            }
            Err(e) => errors.push(format!("{}: {}", candidate, e)),
        }
    }
    let msg = format!("spawn_uvicorn échec:\n{}", errors.join("\n"));
    if let Some(p) = log_path {
        let _ = std::fs::write(p, format!("[HIMYC] {}\n", msg));
    }
    Err(msg)
}

// ─── Commandes Tauri ──────────────────────────────────────────────────────────

#[tauri::command]
fn get_project_path(app: AppHandle) -> Option<String> {
    read_project_path(&app)
}

#[tauri::command]
fn set_project_path(
    app: AppHandle,
    path: String,
    state: State<BackendState>,
) -> Result<(), String> {
    kill_backend(&state);
    write_project_path(&app, &path)?;
    let log = log_path_for(&app);
    *state.log_path.lock().unwrap() = log.clone();
    let child = spawn_uvicorn(&path, log.as_ref())?;
    *state.process.lock().unwrap() = Some(child);
    Ok(())
}

/// Retourne le contenu du log stderr backend pour diagnostic.
#[tauri::command]
fn get_backend_log(state: State<BackendState>) -> String {
    let guard = state.log_path.lock().unwrap();
    match guard.as_ref() {
        None    => "(log non disponible)".into(),
        Some(p) => std::fs::read_to_string(p)
            .unwrap_or_else(|e| format!("(lecture log impossible: {})", e)),
    }
}

// ─── Sidecar loopback fetch ───────────────────────────────────────────────────

#[derive(serde::Serialize)]
struct SidecarFetchResult {
    status: u16,
    ok:     bool,
    body:   String,
}

#[tauri::command]
async fn sidecar_fetch_loopback(
    url:     String,
    method:  Option<String>,
    body:    Option<String>,
    headers: Option<HashMap<String, String>>,
) -> Result<SidecarFetchResult, String> {
    let parsed = reqwest::Url::parse(&url)
        .map_err(|e| format!("URL invalide '{}': {}", url, e))?;
    let host = parsed.host_str().unwrap_or("");
    if host != "127.0.0.1" && host != "localhost" && host != "::1" && host != "[::1]" {
        return Err(format!("seules les adresses loopback sont autorisees, recu '{}'", host));
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("erreur creation client: {}", e))?;

    let method_str = method.as_deref().unwrap_or("GET").to_uppercase();
    let mut req = match method_str.as_str() {
        "GET"    => client.get(&url),
        "POST"   => client.post(&url),
        "PUT"    => client.put(&url),
        "DELETE" => client.delete(&url),
        "PATCH"  => client.patch(&url),
        m => return Err(format!("methode non supportee '{}'", m)),
    };
    if let Some(hdrs) = headers {
        for (k, v) in hdrs { req = req.header(k, v); }
    }
    if let Some(b) = body { req = req.body(b); }

    let resp   = req.send().await.map_err(|e| format!("requete echouee: {}", e))?;
    let status = resp.status().as_u16();
    let ok     = resp.status().is_success();
    let body_t = resp.text().await.map_err(|e| format!("lecture reponse: {}", e))?;
    Ok(SidecarFetchResult { status, ok, body: body_t })
}

// ─── Main ─────────────────────────────────────────────────────────────────────

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(BackendState {
            process:  Mutex::new(None),
            log_path: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            sidecar_fetch_loopback,
            get_project_path,
            set_project_path,
            get_backend_log,
        ])
        .setup(|app| {
            if let Some(path) = read_project_path(app.handle()) {
                let log = log_path_for(app.handle());
                let state = app.state::<BackendState>();
                *state.log_path.lock().unwrap() = log.clone();
                match spawn_uvicorn(&path, log.as_ref()) {
                    Ok(child) => { *state.process.lock().unwrap() = Some(child); }
                    Err(e)    => { eprintln!("HIMYC: {}", e); }
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erreur lors du demarrage de l application HIMYC");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            kill_backend(&app_handle.state::<BackendState>());
        }
    });
}
