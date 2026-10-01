#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]

use tauri::{Manager, Webview};

#[tauri::command]
fn resource_count(webview: Webview) -> usize {
    webview.resources_table().names().count()
}

#[tauri::command]
fn fixture_origin() -> Result<String, String> {
    std::env::var("CRATE_HTTP_RESOURCE_PROBE_ORIGIN")
        .map_err(|error| format!("probe fixture origin is unavailable: {error}"))
}

#[tauri::command]
fn refused_origin() -> Result<String, String> {
    std::env::var("CRATE_HTTP_RESOURCE_PROBE_REFUSED_ORIGIN")
        .map_err(|error| format!("probe refused origin is unavailable: {error}"))
}

#[tauri::command]
fn finish_probe(app: tauri::AppHandle, report: serde_json::Value) {
    let exit_code = if report
        .get("passed")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false)
    {
        0
    } else {
        1
    };
    println!("HTTP_RESOURCE_PROBE={report}");
    app.exit(exit_code);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            resource_count,
            fixture_origin,
            refused_origin,
            finish_probe
        ])
        .run(tauri::generate_context!(
            "tauri.http-resource-probe.conf.json"
        ))
        .expect("failed to run the HTTP resource probe");
}
