#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]

use std::io::Write;

use tauri::{Manager, Webview};

fn write_probe_diagnostic(message: &str) {
    let Some(path) = std::env::var_os("CRATE_HTTP_RESOURCE_PROBE_DIAGNOSTICS") else {
        return;
    };
    let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    else {
        return;
    };
    let _ = writeln!(file, "{message}");
}

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
fn record_probe_diagnostic(message: String) {
    write_probe_diagnostic(&message);
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
        .on_page_load(|webview, payload| {
            write_probe_diagnostic(&format!(
                "page-load:{:?}:{}",
                payload.event(),
                payload.url()
            ));
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                let script = "window.__TAURI_INTERNALS__?.invoke('record_probe_diagnostic', { message: 'native-eval-bridge-available' }).catch(() => undefined);";
                if let Err(error) = webview.eval(script) {
                    write_probe_diagnostic(&format!("native-eval-failed:{error}"));
                } else {
                    write_probe_diagnostic("native-eval-submitted");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            resource_count,
            fixture_origin,
            refused_origin,
            record_probe_diagnostic,
            finish_probe
        ])
        .run(tauri::generate_context!(
            "tauri.http-resource-probe.conf.json"
        ))
        .expect("failed to run the HTTP resource probe");
}
