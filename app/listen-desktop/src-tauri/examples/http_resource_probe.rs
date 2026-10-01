#![cfg_attr(all(not(debug_assertions), windows), windows_subsystem = "windows")]

use std::io::Write;

use tauri::{Manager, Webview};

const EARLY_PAGE_DIAGNOSTICS: &str = r#"
(() => {
  const pending = (window.__CRATE_PROBE_PENDING_DIAGNOSTICS ||= []);
  const record = (message) => {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke === 'function') {
      void invoke('record_probe_diagnostic', { message }).catch(() => undefined);
    } else {
      pending.push(message);
    }
  };
  window.addEventListener('error', (event) => {
    const target = event.target;
    const source = target instanceof HTMLScriptElement ? target.src : '';
    record(`early-window-error:${source || event.message}`);
  }, true);
  window.addEventListener('unhandledrejection', (event) => {
    record(`early-unhandled-rejection:${String(event.reason)}`);
  });
  window.addEventListener('securitypolicyviolation', (event) => {
    record(`csp-violation:${event.effectiveDirective}:${event.blockedURI}`);
  });
  record('native-early-diagnostics-installed');
})();
"#;

const DOCUMENT_DIAGNOSTICS: &str = r#"
(() => {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== 'function') return;
  const record = (message) => {
    void invoke('record_probe_diagnostic', { message }).catch(() => undefined);
  };
  for (const message of window.__CRATE_PROBE_PENDING_DIAGNOSTICS || []) {
    record(message);
  }
  window.__CRATE_PROBE_PENDING_DIAGNOSTICS = [];
  const scripts = Array.from(document.scripts, (script) => ({
    src: script.src,
    type: script.type,
    readyState: script.readyState || null,
  }));
  const state = {
    href: location.href,
    readyState: document.readyState,
    title: document.title,
    status: document.querySelector('#status')?.textContent || null,
    scripts,
    resources: performance.getEntriesByType('resource').map((entry) => entry.name),
  };
  record(`document-state:${JSON.stringify(state)}`);
  for (const script of scripts) {
    if (!script.src) continue;
    void fetch(script.src).then(async (response) => {
      const body = await response.text();
      record(`script-fetch:${JSON.stringify({
        src: script.src,
        status: response.status,
        contentType: response.headers.get('content-type'),
        bytes: body.length,
        preview: body.slice(0, 120),
      })}`);
    }).catch((error) => {
      record(`script-fetch-error:${script.src}:${String(error)}`);
    });
  }
})();
"#;

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
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) {
                if let Err(error) = webview.eval(EARLY_PAGE_DIAGNOSTICS) {
                    write_probe_diagnostic(&format!("early-diagnostics-eval-failed:{error}"));
                }
            }
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                if let Err(error) = webview.eval(DOCUMENT_DIAGNOSTICS) {
                    write_probe_diagnostic(&format!("document-diagnostics-eval-failed:{error}"));
                }
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
