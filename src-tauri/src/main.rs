// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Masque la fenêtre console pour le process Python (Windows).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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

type PythonCandidate = (String, Vec<String>);

/// Cherche python3 via un login shell (PATH complet : pyenv, brew, conda…).
#[cfg(not(windows))]
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

/// Chemins Python usuels sous Windows (hors PATH — les apps GUI ont souvent un PATH minimal).
#[cfg(windows)]
fn push_windows_python_install_dirs(out: &mut Vec<PythonCandidate>) {
    let mut seen = std::collections::HashSet::<String>::new();

    let try_push = |out: &mut Vec<PythonCandidate>, seen: &mut std::collections::HashSet<String>, path: PathBuf| {
        if path.is_file() {
            let s = path.to_string_lossy().to_string();
            if seen.insert(s.clone()) {
                out.push((s, vec![]));
            }
        }
    };

    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let base = PathBuf::from(local).join("Programs").join("Python");
        if let Ok(entries) = std::fs::read_dir(&base) {
            let mut dirs: Vec<_> = entries.filter_map(|e| e.ok()).collect();
            dirs.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
            for e in dirs {
                try_push(out, &mut seen, e.path().join("python.exe"));
            }
        }
    }
    if let Ok(pf) = std::env::var("ProgramFiles") {
        for sub in ["Python312", "Python311", "Python310", "Python39"] {
            try_push(out, &mut seen, PathBuf::from(&pf).join(sub).join("python.exe"));
        }
    }
}

#[cfg(windows)]
fn python_candidates_windows() -> Vec<PythonCandidate> {
    let mut out: Vec<PythonCandidate> = Vec::new();
    // py.exe est souvent dans C:\Windows\ — reste dans le PATH même pour une .exe lancée sans console
    out.push(("py".into(), vec!["-3".into()]));
    out.push(("py".into(), vec![]));
    out.push(("python".into(), vec![]));
    out.push(("python3".into(), vec![]));
    push_windows_python_install_dirs(&mut out);
    out
}

#[cfg(not(windows))]
fn python_candidates_unix() -> Vec<PythonCandidate> {
    let mut out: Vec<PythonCandidate> = Vec::new();
    if let Some(p) = find_python_via_login_shell() {
        out.push((p, vec![]));
    }
    out.extend([
        ("/opt/homebrew/bin/python3".into(), vec![]),
        ("/usr/local/bin/python3".into(), vec![]),
        ("python3".into(), vec![]),
        ("python".into(), vec![]),
    ]);
    out
}

fn python_candidates() -> Vec<PythonCandidate> {
    let mut out: Vec<PythonCandidate> = Vec::new();
    if let Ok(p) = std::env::var("HIMYC_PYTHON") {
        let p = p.trim();
        if !p.is_empty() {
            out.push((p.to_string(), vec![]));
        }
    }
    #[cfg(windows)]
    {
        out.extend(python_candidates_windows());
    }
    #[cfg(not(windows))]
    {
        out.extend(python_candidates_unix());
    }
    out
}

/// Stderr backend : en-tête puis logs uvicorn en append (sans écraser après spawn).
fn stderr_log_for_attempt(log_path: Option<&PathBuf>, header_line: &str) -> Stdio {
    let Some(p) = log_path else {
        return Stdio::null();
    };
    if let Some(parent) = p.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(p, header_line);
    match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(p)
    {
        Ok(f) => Stdio::from(f),
        Err(_) => Stdio::null(),
    }
}

/// Tue tout process occupant le port 8765 (ancien uvicorn d'une session précédente).
fn kill_port_8765() {
    #[cfg(windows)]
    {
        let _ = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Get-NetTCPConnection -LocalPort 8765 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }",
            ])
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("sh")
            .args(["-c", "lsof -ti tcp:8765 2>/dev/null | xargs kill -9 2>/dev/null"])
            .output();
    }
    std::thread::sleep(std::time::Duration::from_millis(400));
}

/// Cherche le sidecar PyInstaller dans le dossier resources de l'app.
/// Présent dans les builds release ; absent en mode dev.
fn find_sidecar(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    #[cfg(windows)]
    let name = "himyc-backend.exe";
    #[cfg(not(windows))]
    let name = "himyc-backend";
    let path = resource_dir.join(name);
    if path.is_file() {
        // Sur Unix, s'assurer que le binaire PyInstaller est exécutable.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755));
        }
        Some(path)
    } else {
        None
    }
}

fn spawn_uvicorn(app: &AppHandle, project_path: &str, log_path: Option<&PathBuf>) -> Result<Child, String> {
    kill_port_8765();

    // Priorité 1 : sidecar PyInstaller (builds release)
    if let Some(sidecar) = find_sidecar(app) {
        let header = format!("[HIMYC] Sidecar : {}\n", sidecar.display());
        let stderr = stderr_log_for_attempt(log_path, &header);
        let mut cmd = Command::new(&sidecar);
        cmd.env("HIMYC_PROJECT_PATH", project_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(stderr);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        match cmd.spawn() {
            Ok(child) => return Ok(child),
            Err(e) => {
                let msg = format!("[HIMYC] Sidecar échec ({}): {}\n", sidecar.display(), e);
                if let Some(p) = log_path {
                    let _ = std::fs::write(p, &msg);
                }
            }
        }
    }

    // Priorité 2 : Python système (mode dev)
    let candidates = python_candidates();
    let mut errors: Vec<String> = Vec::new();

    for (exe, prefix) in candidates {
        let label = if prefix.is_empty() {
            exe.clone()
        } else {
            format!("{} {}", exe, prefix.join(" "))
        };
        let header = format!("[HIMYC] Démarré avec : {}\n", label);
        let stderr = stderr_log_for_attempt(log_path, &header);

        let mut cmd = Command::new(&exe);
        for a in &prefix {
            cmd.arg(a);
        }
        cmd.args([
            "-m",
            "uvicorn",
            "howimetyourcorpus.api.server:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8765",
            "--no-access-log",
        ])
        .env("HIMYC_PROJECT_PATH", project_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(stderr);

        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        match cmd.spawn() {
            Ok(child) => return Ok(child),
            Err(e) => errors.push(format!("{}: {}", label, e)),
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
    let child = spawn_uvicorn(&app, &path, log.as_ref())?;
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
                match spawn_uvicorn(app.handle(), &path, log.as_ref()) {
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
