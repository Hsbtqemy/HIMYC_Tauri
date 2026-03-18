// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;

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
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![sidecar_fetch_loopback])
        .run(tauri::generate_context!())
        .expect("erreur lors du demarrage de l application HIMYC");
}
