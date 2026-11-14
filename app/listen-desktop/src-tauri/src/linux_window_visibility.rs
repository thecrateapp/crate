//! Whether Crate's window is actually on screen, as the compositor sees it.
//!
//! WebKitGTK (GTK 3) cannot tell: GTK 3 has no `suspended` toplevel state, so
//! a window on a workspace that no monitor shows stays "visible" to WebKit.
//! `document.visibilityState` stays `visible`, requestAnimationFrame keeps
//! firing and CSS animations keep repainting (measured on WebKitGTK 2.54 with
//! Hyprland 0.57). Listen pauses its decorative motion when this module reports
//! the window hidden; audio is never affected.
//!
//! Only Hyprland is supported: its IPC socket says which workspace every
//! monitor shows. Elsewhere the state stays unknown and Listen keeps animating.

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Runtime};

use crate::linux_desktop_profile::{self, Compositor, LINUX_APP_ID};

/// Event carrying `true` (on screen) or `false` (hidden) to the webview.
pub const VISIBILITY_EVENT: &str = "crate:window-visibility";

const UNKNOWN: u8 = 0;
const VISIBLE: u8 = 1;
const HIDDEN: u8 = 2;
static STATE: AtomicU8 = AtomicU8::new(UNKNOWN);

/// Events that never change which windows are shown. Everything else
/// (workspace switches, moves, fullscreen, monitors, open/close) recomputes.
const IGNORED_EVENTS: &[&str] = &[
    "activewindow",
    "activewindowv2",
    "windowtitle",
    "windowtitlev2",
    "activelayout",
    "submap",
    "bell",
];

/// Coalesces a burst of events (a workspace switch emits several).
const SETTLE: Duration = Duration::from_millis(120);
const RECONNECT_DELAY: Duration = Duration::from_secs(2);

/// Last known state: `Some(true)` on screen, `Some(false)` hidden, `None` unknown.
pub fn current() -> Option<bool> {
    match STATE.load(Ordering::Relaxed) {
        VISIBLE => Some(true),
        HIDDEN => Some(false),
        _ => None,
    }
}

pub fn install<R: Runtime>(app: &AppHandle<R>) {
    if linux_desktop_profile::current().compositor != Compositor::Hyprland {
        return;
    }
    let Some(dir) = hyprland_socket_dir() else {
        return;
    };
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("crate-window-visibility".into())
        .spawn(move || loop {
            if let Err(err) = follow_hyprland(&app, &dir) {
                eprintln!("Hyprland window visibility unavailable: {err}");
            }
            std::thread::sleep(RECONNECT_DELAY);
        });
    if let Err(err) = spawned {
        eprintln!("failed to start the window visibility watcher: {err}");
    }
}

fn hyprland_socket_dir() -> Option<PathBuf> {
    let signature = std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE")?;
    let runtime = std::env::var_os("XDG_RUNTIME_DIR")?;
    Some(PathBuf::from(runtime).join("hypr").join(signature))
}

fn follow_hyprland<R: Runtime>(app: &AppHandle<R>, dir: &Path) -> std::io::Result<()> {
    let events = UnixStream::connect(dir.join(".socket2.sock"))?;
    let mut reader = BufReader::new(events);
    refresh(app, dir);
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "Hyprland closed its event socket",
            ));
        }
        if !is_relevant_event(&line) {
            continue;
        }
        drain_burst(&mut reader)?;
        refresh(app, dir);
    }
}

/// Swallow the rest of an event burst so one switch costs one query.
fn drain_burst(reader: &mut BufReader<UnixStream>) -> std::io::Result<()> {
    reader.get_ref().set_read_timeout(Some(SETTLE))?;
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => continue,
            Err(err)
                if matches!(
                    err.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                break
            }
            Err(err) => {
                reader.get_ref().set_read_timeout(None)?;
                return Err(err);
            }
        }
    }
    reader.get_ref().set_read_timeout(None)
}

fn is_relevant_event(line: &str) -> bool {
    let name = line.split(">>").next().unwrap_or("").trim();
    !name.is_empty() && !IGNORED_EVENTS.contains(&name)
}

fn refresh<R: Runtime>(app: &AppHandle<R>, dir: &Path) {
    let (Ok(clients), Ok(monitors)) = (query(dir, "j/clients"), query(dir, "j/monitors")) else {
        return;
    };
    let Some(visible) = hyprland_visibility(&clients, &monitors, std::process::id(), LINUX_APP_ID)
    else {
        return;
    };
    let next = if visible { VISIBLE } else { HIDDEN };
    if STATE.swap(next, Ordering::Relaxed) != next {
        let _ = app.emit(VISIBILITY_EVENT, visible);
    }
}

fn query(dir: &Path, command: &str) -> std::io::Result<Value> {
    let mut stream = UnixStream::connect(dir.join(".socket.sock"))?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.write_all(command.as_bytes())?;
    let mut body = Vec::new();
    stream.read_to_end(&mut body)?;
    serde_json::from_slice(&body).map_err(std::io::Error::other)
}

/// Decide from Hyprland's `j/clients` and `j/monitors` output whether any of
/// this process's windows is on a workspace a powered monitor shows.
/// `None` when the window is not found (unknown, so Listen keeps animating).
pub fn hyprland_visibility(
    clients: &Value,
    monitors: &Value,
    pid: u32,
    app_id: &str,
) -> Option<bool> {
    let clients = clients.as_array()?;
    let ours: Vec<&Value> = clients
        .iter()
        .filter(|client| {
            client.get("pid").and_then(Value::as_u64) == Some(u64::from(pid))
                && client.get("class").and_then(Value::as_str) == Some(app_id)
        })
        .collect();
    if ours.is_empty() {
        return None;
    }

    let shown: Vec<&str> = monitors
        .as_array()?
        .iter()
        .filter(|monitor| {
            monitor.get("disabled").and_then(Value::as_bool) != Some(true)
                && monitor.get("dpmsStatus").and_then(Value::as_bool) != Some(false)
        })
        .flat_map(|monitor| {
            ["activeWorkspace", "specialWorkspace"]
                .into_iter()
                .filter_map(|key| workspace_name(monitor.get(key)?))
        })
        .collect();

    let visible = ours.iter().any(|client| {
        if !is_shown_window(client) {
            return false;
        }
        let Some(workspace) = client.get("workspace").and_then(workspace_name) else {
            return false;
        };
        if !shown.contains(&workspace) {
            return false;
        }
        let floating = client.get("floating").and_then(Value::as_bool) == Some(true);
        floating
            || !clients.iter().any(|other| {
                other.get("pid").and_then(Value::as_u64) != Some(u64::from(pid))
                    && is_shown_window(other)
                    && other.get("workspace").and_then(workspace_name) == Some(workspace)
                    && other.get("fullscreen").and_then(Value::as_u64) == Some(2)
            })
    });
    Some(visible)
}

fn is_shown_window(client: &Value) -> bool {
    client.get("mapped").and_then(Value::as_bool) != Some(false)
        && client.get("hidden").and_then(Value::as_bool) != Some(true)
}

fn workspace_name(workspace: &Value) -> Option<&str> {
    workspace
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const PID: u32 = 4242;

    fn crate_window(workspace: &str) -> Value {
        json!({
            "pid": PID, "class": LINUX_APP_ID, "mapped": true, "hidden": false,
            "floating": false, "fullscreen": 0,
            "workspace": { "id": 1, "name": workspace }
        })
    }

    fn monitors(shown: &[(&str, &str)]) -> Value {
        Value::Array(
            shown
                .iter()
                .map(|(active, special)| {
                    json!({
                        "disabled": false, "dpmsStatus": true,
                        "activeWorkspace": { "id": 1, "name": active },
                        "specialWorkspace": { "name": special }
                    })
                })
                .collect(),
        )
    }

    #[test]
    fn visible_on_a_workspace_any_monitor_shows_even_without_focus() {
        let clients = json!([crate_window("1")]);
        let monitors = monitors(&[("1", ""), ("2", "")]);
        assert_eq!(
            hyprland_visibility(&clients, &monitors, PID, LINUX_APP_ID),
            Some(true)
        );
    }

    #[test]
    fn hidden_on_a_workspace_no_monitor_shows() {
        let clients = json!([crate_window("1")]);
        let monitors = monitors(&[("2", ""), ("3", "")]);
        assert_eq!(
            hyprland_visibility(&clients, &monitors, PID, LINUX_APP_ID),
            Some(false)
        );
    }

    #[test]
    fn visible_on_a_shown_special_workspace() {
        let clients = json!([crate_window("special:music")]);
        let monitors = monitors(&[("2", "special:music")]);
        assert_eq!(
            hyprland_visibility(&clients, &monitors, PID, LINUX_APP_ID),
            Some(true)
        );
    }

    #[test]
    fn hidden_when_the_monitor_is_off() {
        let clients = json!([crate_window("1")]);
        let monitors = json!([{
            "disabled": false, "dpmsStatus": false,
            "activeWorkspace": { "name": "1" }, "specialWorkspace": { "name": "" }
        }]);
        assert_eq!(
            hyprland_visibility(&clients, &monitors, PID, LINUX_APP_ID),
            Some(false)
        );
    }

    #[test]
    fn hidden_behind_another_apps_fullscreen_window_unless_floating() {
        let other = json!({
            "pid": 7, "class": "mpv", "mapped": true, "hidden": false,
            "fullscreen": 2, "workspace": { "name": "1" }
        });
        let monitors = monitors(&[("1", "")]);
        let tiled = json!([crate_window("1"), other.clone()]);
        assert_eq!(
            hyprland_visibility(&tiled, &monitors, PID, LINUX_APP_ID),
            Some(false)
        );

        let mut floating_window = crate_window("1");
        floating_window["floating"] = json!(true);
        let floating = json!([floating_window, other]);
        assert_eq!(
            hyprland_visibility(&floating, &monitors, PID, LINUX_APP_ID),
            Some(true)
        );
    }

    #[test]
    fn hidden_when_unmapped_or_hidden_to_the_tray() {
        let mut window = crate_window("1");
        window["mapped"] = json!(false);
        let monitors = monitors(&[("1", "")]);
        assert_eq!(
            hyprland_visibility(&json!([window]), &monitors, PID, LINUX_APP_ID),
            Some(false)
        );
    }

    #[test]
    fn unknown_when_the_window_is_not_listed() {
        let clients = json!([{ "pid": 1, "class": "kitty", "workspace": { "name": "1" } }]);
        let monitors = monitors(&[("1", "")]);
        assert_eq!(
            hyprland_visibility(&clients, &monitors, PID, LINUX_APP_ID),
            None
        );
    }

    #[test]
    fn focus_and_title_events_do_not_trigger_a_query() {
        assert!(!is_relevant_event("activewindow>>kitty,zsh\n"));
        assert!(!is_relevant_event("windowtitlev2>>abc,title\n"));
        assert!(is_relevant_event("workspacev2>>2,2\n"));
        assert!(is_relevant_event("movewindowv2>>abc,9,9\n"));
        assert!(is_relevant_event("fullscreen>>1\n"));
        assert!(!is_relevant_event("\n"));
    }
}
