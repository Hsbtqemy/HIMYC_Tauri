// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

// ─── Backend state ────────────────────────────────────────────────────────────

struct BackendState {
    process: Mutex<Option<Child>>,
}

fn kill_backend(state: &BackendState) {
    if let Ok(mut guard) = state.process.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn config_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("himyc_config.json"))
        .map_err(|e| format!("app_data_dir: {}", e))
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
    let val = serde_json::json!({ "project_path": path });
    std::fs::write(&cfg, val.to_string())
        .map_err(|e| format!("write config: {}", e))
}

/// Cherche python3 via un login shell pour obtenir le PATH complet de l'utilisateur
/// (pyenv, conda, brew, etc.) — les apps macOS lancées depuis Finder/Dock
/// n'héritent pas du PATH de la session shell.
fn find_python_via_login_shell() -> Option<String> {
    for shell in ["/bin/zsh", "/bin/bash"] {
        if let Ok(out) = Command::new(shell)
            .args(["-lc", "which python3 2>/dev/null || which python 2>/dev/null"])
            .output()
        {
            if out.status.success() {
                let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !path.is_empty() {
                    return Some(path);
                }
            }
        }
    }
    None
}

fn spawn_uvicorn(project_path: &str) -> Result<Child, String> {
    // Candidats Python par ordre de priorité :
    // 1. Python trouvé via login shell (PATH complet — pyenv, brew, conda)
    // 2. Chemins courants Homebrew Apple Silicon / Intel
    // 3. Noms génériques (PATH restreint de l'app)
    let mut candidates: Vec<String> = Vec::new();
    if let Some(p) = find_python_via_login_shell() {
        candidates.push(p);
    }
    candidates.extend([
        "/opt/homebrew/bin/python3".into(),  // Homebrew Apple Silicon
        "/usr/local/bin/python3".into(),     // Homebrew Intel
        "python3".into(),
        "python".into(),
    ]);

    let mut last_err = String::new();
    for candidate in &candidates {
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
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(child) => return Ok(child),
            Err(e) => last_err = format!("{}: {}", candidate, e),
        }
    }
    Err(format!("spawn_uvicorn: python introuvable — {}", last_err))
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
    // Tuer l'ancien process si présent
    kill_backend(&state);

    // Persister le chemin
    write_project_path(&app, &path)?;

    // Lancer uvicorn
    let child = spawn_uvicorn(&path)?;
    *state.process.lock().unwrap() = Some(child);
    Ok(())
}

// ─── Sidecar loopback fetch ───────────────────────────────────────────────────
//
// Contourne les restrictions CSP Tauri pour les appels loopback vers le backend
// Python HIMYC. Restreint aux adresses loopback (127.0.0.1, localhost, ::1).

#[derive(serde::Serialize)]
struct SidecarFetchResult {
    status: u16,
    ok: bool,
    body: String,
}

/// HTTP request direct via reqwest, restreint aux adresses loopback.
#[tauri::command]
async fn sidecar_fetch_loopback(
    url: String,
    method: Option<String>,
    body: Option<String>,
    headers: Option<HashMap<String, String>>,
) -> Result<SidecarFetchResult, String> {
    let parsed = reqwest::Url::parse(&url)
        .map_err(|e| format!("sidecar_fetch_loopback: URL invalide '{}': {}", url, e))?;
    let host = parsed.host_str().unwrap_or("");
    if host != "127.0.0.1" && host != "localhost" && host != "::1" && host != "[::1]" {
        return Err(format!(
            "sidecar_fetch_loopback: seules les adresses loopback sont autorisees, recu '{}'",
            host
        ));
    }

    let client = reqwest::Client::builder()
        .no_proxy()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("sidecar_fetch_loopback: erreur creation client: {}", e))?;

    let method_str = method.as_deref().unwrap_or("GET").to_uppercase();
    let mut req_builder = match method_str.as_str() {
        "GET"    => client.get(&url),
        "POST"   => client.post(&url),
        "PUT"    => client.put(&url),
        "DELETE" => client.delete(&url),
        "PATCH"  => client.patch(&url),
        m => return Err(format!("sidecar_fetch_loopback: methode non supportee '{}'", m)),
    };

    if let Some(hdrs) = headers {
        for (k, v) in hdrs {
            req_builder = req_builder.header(k, v);
        }
    }
    if let Some(b) = body {
        req_builder = req_builder.body(b);
    }

    let response = req_builder
        .send()
        .await
        .map_err(|e| format!("sidecar_fetch_loopback: requete vers '{}' echouee: {}", url, e))?;

    let status = response.status().as_u16();
    let ok = response.status().is_success();
    let body_text = response
        .text()
        .await
        .map_err(|e| format!("sidecar_fetch_loopback: erreur lecture reponse: {}", e))?;

    Ok(SidecarFetchResult { status, ok, body: body_text })
}

// ─── Main ─────────────────────────────────────────────────────────────────────

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(BackendState { process: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            sidecar_fetch_loopback,
            get_project_path,
            set_project_path,
        ])
        .setup(|app| {
            // Si un chemin projet est déjà sauvegardé, lancer le backend immédiatement
            if let Some(path) = read_project_path(app.handle()) {
                let state = app.state::<BackendState>();
                match spawn_uvicorn(&path) {
                    Ok(child) => { *state.process.lock().unwrap() = Some(child); }
                    Err(e) => { eprintln!("HIMYC: spawn_uvicorn au démarrage: {}", e); }
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erreur lors du demarrage de l application HIMYC");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            let state = app_handle.state::<BackendState>();
            kill_backend(&state);
        }
    });
}
