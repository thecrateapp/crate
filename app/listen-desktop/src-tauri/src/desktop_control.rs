//! Local control channel for desktop widgets (the Ryoku bar's Crate plugin,
//! scripts, launchers).
//!
//! Listen publishes a small state object (volume, shuffle, repeat, equalizer)
//! with `update_desktop_control_state`. On Linux the shell serves it on a Unix
//! socket at `$XDG_RUNTIME_DIR/crate/control.sock` (directory 0700, socket
//! 0600, so only this user can connect), one JSON object per line:
//!
//! - server -> client: `{"type":"hello",...}` on connect, then
//!   `{"type":"state","protocol":1,"player":{...},"eq":{...}}` whenever the
//!   state changes, and `{"type":"ack"}` / `{"type":"error","error":"..."}` for
//!   each command line;
//! - client -> server: a command such as `{"cmd":"play_pause"}`,
//!   `{"cmd":"eq_mode","mode":"genre"}` or `{"cmd":"set_volume","volume":0.6}`.
//!
//! Commands are validated here, then routed: transport through the same path
//! as the tray and `--crate-command`, `show` to the window, and everything else
//! to the webview as the `crate:control-command` event. Mirrors
//! `app/listen/src/lib/desktop-control.ts`: update both together.

use serde::{Deserialize, Serialize};

pub const CONTROL_PROTOCOL: u32 = 1;
pub const CONTROL_EVENT: &str = "crate:control-command";
pub const EQ_BAND_COUNT: usize = 10;
const EQ_GAIN_LIMIT: f64 = 12.0;
/// Upper bound for one published state object, and for one command line.
pub const MAX_STATE_BYTES: usize = 16 * 1024;
pub const MAX_COMMAND_BYTES: usize = 4 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RepeatMode {
    Off,
    One,
    All,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EqMode {
    Smart,
    Genre,
    Adaptive,
    Manual,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum ControlCommand {
    Play,
    Pause,
    PlayPause,
    Next,
    Previous,
    Show,
    Seek {
        position: f64,
    },
    SetVolume {
        volume: f64,
    },
    SetShuffle {
        on: bool,
    },
    SetRepeat {
        mode: RepeatMode,
    },
    EqEnabled {
        on: bool,
    },
    EqMode {
        mode: EqMode,
    },
    EqPreset {
        preset: String,
    },
    EqGains {
        gains: Vec<f64>,
    },
    /// Search the library; answered with a `result` line to this client only.
    Search {
        query: String,
    },
    /// Play a search result: the `ref` object a `result` item carried.
    PlayItem {
        item: serde_json::Value,
    },
}

pub const MAX_QUERY_CHARS: usize = 200;
const PLAY_KINDS: &[&str] = &["track", "album", "artist"];

/// Where a validated command goes.
#[derive(Clone, Debug, PartialEq)]
pub enum Route {
    /// A tray/menu id handled by `handle_playback_menu_event`.
    Transport(&'static str),
    ShowWindow,
    /// The command, as JSON, for the webview.
    Webview(serde_json::Value),
}

impl ControlCommand {
    /// Parse and validate one command line.
    pub fn parse(line: &str) -> Result<ControlCommand, String> {
        if line.len() > MAX_COMMAND_BYTES {
            return Err("command too long".into());
        }
        let command: ControlCommand =
            serde_json::from_str(line.trim()).map_err(|err| format!("invalid command: {err}"))?;
        command.validated()
    }

    /// Range checks and clamping; rejects what cannot be clamped.
    pub fn validated(self) -> Result<ControlCommand, String> {
        Ok(match self {
            ControlCommand::Seek { position } => {
                if !position.is_finite() || position < 0.0 {
                    return Err("position must be a non-negative number of seconds".into());
                }
                ControlCommand::Seek { position }
            }
            ControlCommand::SetVolume { volume } => {
                if !volume.is_finite() {
                    return Err("volume must be a number".into());
                }
                ControlCommand::SetVolume {
                    volume: volume.clamp(0.0, 1.0),
                }
            }
            ControlCommand::EqPreset { preset } => {
                let valid = !preset.is_empty()
                    && preset.len() <= 32
                    && preset
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
                if !valid {
                    return Err("unknown preset".into());
                }
                ControlCommand::EqPreset { preset }
            }
            ControlCommand::EqGains { gains } => {
                if gains.len() != EQ_BAND_COUNT || !gains.iter().all(|g| g.is_finite()) {
                    return Err(format!("gains must be {EQ_BAND_COUNT} numbers"));
                }
                ControlCommand::EqGains {
                    gains: gains
                        .into_iter()
                        .map(|g| g.clamp(-EQ_GAIN_LIMIT, EQ_GAIN_LIMIT))
                        .collect(),
                }
            }
            ControlCommand::Search { query } => {
                let query = query.trim().to_string();
                if query.is_empty() || query.chars().count() > MAX_QUERY_CHARS {
                    return Err(format!("query must be 1-{MAX_QUERY_CHARS} characters"));
                }
                ControlCommand::Search { query }
            }
            ControlCommand::PlayItem { item } => {
                let kind = item.get("kind").and_then(|k| k.as_str()).unwrap_or("");
                if !item.is_object() || !PLAY_KINDS.contains(&kind) {
                    return Err(
                        "item must be a search result ref (kind track, album or artist)".into(),
                    );
                }
                ControlCommand::PlayItem { item }
            }
            other => other,
        })
    }

    pub fn route(&self) -> Route {
        match self {
            ControlCommand::Play => Route::Transport("play"),
            ControlCommand::Pause => Route::Transport("pause"),
            ControlCommand::PlayPause => Route::Transport("play_pause"),
            ControlCommand::Next => Route::Transport("next"),
            ControlCommand::Previous => Route::Transport("previous"),
            ControlCommand::Show => Route::ShowWindow,
            other => Route::Webview(serde_json::to_value(other).unwrap_or_default()),
        }
    }
}

/// Validate a state object from Listen and wrap it for the wire.
pub fn state_line(state: &serde_json::Value) -> Result<String, String> {
    let object = state.as_object().ok_or("state must be an object")?;
    if !object.get("player").is_some_and(|v| v.is_object())
        || !object.get("eq").is_some_and(|v| v.is_object())
    {
        return Err("state needs player and eq objects".into());
    }
    let mut wire = serde_json::Map::new();
    wire.insert("type".into(), "state".into());
    wire.insert("protocol".into(), CONTROL_PROTOCOL.into());
    wire.insert("player".into(), object["player"].clone());
    wire.insert("eq".into(), object["eq"].clone());
    let line = serde_json::to_string(&wire).map_err(|err| err.to_string())?;
    if line.len() > MAX_STATE_BYTES {
        return Err("state too large".into());
    }
    Ok(line)
}

/// `version` is the app version the user sees (`package_info`), which the
/// release tooling injects; the Cargo package version stays at 0.1.0.
pub fn hello_line(version: &str) -> String {
    serde_json::json!({
        "type": "hello",
        "app": "crate",
        "version": version,
        "protocol": CONTROL_PROTOCOL,
    })
    .to_string()
}

/// The answer to one `search`, for the client that asked.
pub fn result_line(request: u64, items: &serde_json::Value) -> Result<String, String> {
    if !items.is_array() {
        return Err("items must be an array".into());
    }
    let line =
        serde_json::json!({"type": "result", "request": request, "items": items}).to_string();
    if line.len() > MAX_STATE_BYTES * 4 {
        return Err("result too large".into());
    }
    Ok(line)
}

pub fn ack_line(result: &Result<ControlCommand, String>) -> String {
    match result {
        Ok(_) => serde_json::json!({"type": "ack"}).to_string(),
        Err(error) => serde_json::json!({"type": "error", "error": error}).to_string(),
    }
}

/// Run a validated command in the app.
pub fn dispatch<R: tauri::Runtime>(app: &tauri::AppHandle<R>, command: &ControlCommand) {
    use tauri::Emitter;
    match command.route() {
        Route::Transport(id) => crate::handle_playback_menu_event(app, id),
        Route::ShowWindow => crate::show_main_window(app),
        Route::Webview(payload) => {
            let _ = app.emit(CONTROL_EVENT, payload);
        }
    }
}

/// Latest published state, for MPRIS (volume, shuffle, loop).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlayerExtras {
    pub volume: f64,
    pub shuffle: bool,
    pub repeat: RepeatMode,
}

pub fn player_extras(state: &serde_json::Value) -> Option<PlayerExtras> {
    let player = state.get("player")?;
    Some(PlayerExtras {
        volume: player.get("volume")?.as_f64()?.clamp(0.0, 1.0),
        shuffle: player.get("shuffle")?.as_bool()?,
        repeat: serde_json::from_value(player.get("repeat")?.clone()).ok()?,
    })
}

#[cfg(target_os = "linux")]
pub use socket::{install, publish_state, reply};

#[cfg(not(target_os = "linux"))]
pub fn publish_state(_line: String) {}

#[cfg(not(target_os = "linux"))]
pub fn reply(_request: u64, _line: String) -> bool {
    false
}

#[cfg(target_os = "linux")]
mod socket {
    use std::{
        io::{BufRead, BufReader, Read, Write},
        os::unix::{
            fs::{DirBuilderExt, PermissionsExt},
            net::{UnixListener, UnixStream},
        },
        path::PathBuf,
        sync::{Mutex, OnceLock},
        thread,
        time::Duration,
    };

    use super::{ack_line, hello_line, ControlCommand, MAX_COMMAND_BYTES};

    #[derive(Default)]
    struct Hub {
        state: Option<String>,
        clients: Vec<UnixStream>,
        /// open `search` requests: id -> the asking client (and when it asked)
        pending: std::collections::HashMap<u64, (UnixStream, std::time::Instant)>,
        next_request: u64,
    }

    const REQUEST_TTL: Duration = Duration::from_secs(15);

    /// Send a search result to the client that asked; false if it is gone.
    pub fn reply(request: u64, line: String) -> bool {
        let mut hub = hub().lock().unwrap_or_else(|p| p.into_inner());
        hub.pending
            .retain(|_, (_, asked)| asked.elapsed() < REQUEST_TTL);
        match hub.pending.remove(&request) {
            Some((mut client, _)) => write_line(&mut client, &line).is_ok(),
            None => false,
        }
    }

    fn hub() -> &'static Mutex<Hub> {
        static HUB: OnceLock<Mutex<Hub>> = OnceLock::new();
        HUB.get_or_init(|| Mutex::new(Hub::default()))
    }

    pub fn socket_path() -> Option<PathBuf> {
        let runtime = std::env::var_os("XDG_RUNTIME_DIR")?;
        Some(PathBuf::from(runtime).join("crate").join("control.sock"))
    }

    fn write_line(stream: &mut UnixStream, line: &str) -> std::io::Result<()> {
        stream.write_all(line.as_bytes())?;
        stream.write_all(b"\n")
    }

    /// Store the newest state line and send it to every client; clients that
    /// cannot keep up (write timeout) or went away are dropped.
    pub fn publish_state(line: String) {
        let mut hub = hub().lock().unwrap_or_else(|p| p.into_inner());
        if hub.state.as_deref() == Some(line.as_str()) {
            return;
        }
        hub.clients
            .retain_mut(|client| write_line(client, &line).is_ok());
        hub.state = Some(line);
    }

    pub fn install(app: &tauri::AppHandle) {
        let Some(path) = socket_path() else {
            eprintln!("Crate control socket disabled: XDG_RUNTIME_DIR is not set");
            return;
        };
        let app = app.clone();
        let spawned = thread::Builder::new()
            .name("crate-control".into())
            .spawn(move || {
                if let Err(err) = serve(app, path) {
                    eprintln!("Crate control socket stopped: {err}");
                }
            });
        if let Err(err) = spawned {
            eprintln!("failed to start the Crate control socket: {err}");
        }
    }

    fn serve(app: tauri::AppHandle, path: PathBuf) -> std::io::Result<()> {
        let dir = path.parent().expect("socket path has a parent");
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(dir)?;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        // Single-instance guarantees no other Crate owns it: a leftover file is stale.
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
        let listener = UnixListener::bind(&path)?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;

        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let app = app.clone();
            let _ = thread::Builder::new()
                .name("crate-control-client".into())
                .spawn(move || serve_client(app, stream));
        }
        Ok(())
    }

    fn serve_client(app: tauri::AppHandle, stream: UnixStream) {
        let _ = stream.set_write_timeout(Some(Duration::from_millis(250)));
        let Ok(mut writer) = stream.try_clone() else {
            return;
        };
        {
            let mut hub = hub().lock().unwrap_or_else(|p| p.into_inner());
            let version = app.package_info().version.to_string();
            if write_line(&mut writer, &hello_line(&version)).is_err() {
                return;
            }
            if let Some(state) = hub.state.clone() {
                if write_line(&mut writer, &state).is_err() {
                    return;
                }
            }
            if let Ok(broadcast) = stream.try_clone() {
                hub.clients.push(broadcast);
            }
        }

        // One command per line; a line longer than the limit ends the session.
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        loop {
            line.clear();
            match (&mut reader)
                .take(MAX_COMMAND_BYTES as u64 + 1)
                .read_line(&mut line)
            {
                Ok(0) | Err(_) => break,
                Ok(_) if line.len() > MAX_COMMAND_BYTES => {
                    let _ = write_line(
                        &mut writer,
                        r#"{"type":"error","error":"command too long"}"#,
                    );
                    break;
                }
                Ok(_) => {
                    if line.trim().is_empty() {
                        continue;
                    }
                    let result = ControlCommand::parse(&line);
                    let ack = match &result {
                        Ok(ControlCommand::Search { query }) => {
                            // answered later by Listen through `desktop_control_reply`
                            let request = {
                                let mut hub = hub().lock().unwrap_or_else(|p| p.into_inner());
                                hub.next_request += 1;
                                let request = hub.next_request;
                                if let Ok(client) = writer.try_clone() {
                                    hub.pending
                                        .insert(request, (client, std::time::Instant::now()));
                                }
                                request
                            };
                            use tauri::Emitter;
                            let _ = app.emit(
                                super::CONTROL_EVENT,
                                serde_json::json!({"cmd": "search", "query": query, "request": request}),
                            );
                            serde_json::json!({"type": "ack", "request": request}).to_string()
                        }
                        Ok(command) => {
                            super::dispatch(&app, command);
                            ack_line(&result)
                        }
                        Err(_) => ack_line(&result),
                    };
                    if write_line(&mut writer, &ack).is_err() {
                        break;
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_routes_transport_and_window_commands() {
        let cases = [
            (r#"{"cmd":"play"}"#, Route::Transport("play")),
            (r#"{"cmd":"pause"}"#, Route::Transport("pause")),
            (r#"{"cmd":"play_pause"}"#, Route::Transport("play_pause")),
            (r#"{"cmd":"next"}"#, Route::Transport("next")),
            (r#"{"cmd":"previous"}"#, Route::Transport("previous")),
            (r#"{"cmd":"show"}"#, Route::ShowWindow),
        ];
        for (line, route) in cases {
            assert_eq!(
                ControlCommand::parse(line).unwrap().route(),
                route,
                "{line}"
            );
        }
    }

    #[test]
    fn transport_routes_are_known_menu_ids() {
        for id in ["play", "pause", "play_pause", "next", "previous"] {
            assert!(crate::PlaybackCommand::parse(id).is_some(), "{id}");
        }
    }

    #[test]
    fn relays_player_and_equalizer_commands_to_the_webview() {
        let cases = [
            (
                r#"{"cmd":"seek","position":12.5}"#,
                serde_json::json!({"cmd":"seek","position":12.5}),
            ),
            (
                r#"{"cmd":"set_volume","volume":4}"#,
                serde_json::json!({"cmd":"set_volume","volume":1.0}),
            ),
            (
                r#"{"cmd":"set_shuffle","on":true}"#,
                serde_json::json!({"cmd":"set_shuffle","on":true}),
            ),
            (
                r#"{"cmd":"set_repeat","mode":"one"}"#,
                serde_json::json!({"cmd":"set_repeat","mode":"one"}),
            ),
            (
                r#"{"cmd":"eq_enabled","on":false}"#,
                serde_json::json!({"cmd":"eq_enabled","on":false}),
            ),
            (
                r#"{"cmd":"eq_mode","mode":"genre"}"#,
                serde_json::json!({"cmd":"eq_mode","mode":"genre"}),
            ),
            (
                r#"{"cmd":"eq_preset","preset":"post_rock"}"#,
                serde_json::json!({"cmd":"eq_preset","preset":"post_rock"}),
            ),
        ];
        for (line, payload) in cases {
            assert_eq!(
                ControlCommand::parse(line).unwrap().route(),
                Route::Webview(payload),
                "{line}"
            );
        }
        let gains =
            ControlCommand::parse(r#"{"cmd":"eq_gains","gains":[13,-13,0,0,0,0,0,0,0,1.5]}"#)
                .unwrap();
        assert_eq!(
            gains,
            ControlCommand::EqGains {
                gains: vec![12.0, -12.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.5]
            }
        );
    }

    #[test]
    fn rejects_bad_commands() {
        for line in [
            "",
            "play",
            r#"{"cmd":"quit"}"#,
            r#"{"cmd":"hide"}"#,
            r#"{"cmd":"seek","position":-1}"#,
            r#"{"cmd":"seek"}"#,
            r#"{"cmd":"set_repeat","mode":"forever"}"#,
            r#"{"cmd":"eq_mode","mode":"loud"}"#,
            r#"{"cmd":"eq_preset","preset":"../etc"}"#,
            r#"{"cmd":"eq_preset","preset":""}"#,
            r#"{"cmd":"eq_gains","gains":[1,2,3]}"#,
        ] {
            assert!(ControlCommand::parse(line).is_err(), "{line}");
        }
        let long = format!(
            r#"{{"cmd":"eq_preset","preset":"{}"}}"#,
            "a".repeat(MAX_COMMAND_BYTES)
        );
        assert!(ControlCommand::parse(&long).is_err());
    }

    #[test]
    fn validates_search_and_play_item() {
        assert_eq!(
            ControlCommand::parse(r#"{"cmd":"search","query":"  nick cave "}"#).unwrap(),
            ControlCommand::Search {
                query: "nick cave".into()
            }
        );
        assert!(ControlCommand::parse(r#"{"cmd":"search","query":"   "}"#).is_err());
        let long = format!(
            r#"{{"cmd":"search","query":"{}"}}"#,
            "a".repeat(MAX_QUERY_CHARS + 1)
        );
        assert!(ControlCommand::parse(&long).is_err());

        let play = ControlCommand::parse(
            r#"{"cmd":"play_item","item":{"kind":"album","album":{"album":"X","artist":"Y"}}}"#,
        )
        .unwrap();
        assert!(matches!(play.route(), Route::Webview(_)));
        assert!(
            ControlCommand::parse(r#"{"cmd":"play_item","item":{"kind":"playlist"}}"#).is_err()
        );
        assert!(ControlCommand::parse(r#"{"cmd":"play_item","item":"album"}"#).is_err());
    }

    #[test]
    fn result_lines_carry_the_request_id() {
        let line: serde_json::Value =
            serde_json::from_str(&result_line(7, &serde_json::json!([{"kind": "track"}])).unwrap())
                .unwrap();
        assert_eq!(line["type"], "result");
        assert_eq!(line["request"], 7);
        assert!(result_line(7, &serde_json::json!({})).is_err());
    }

    #[test]
    fn wraps_listen_state_for_the_wire() {
        let state = serde_json::json!({
            "player": {"volume": 0.5, "shuffle": true, "repeat": "all"},
            "eq": {"enabled": true, "mode": "smart"},
            "ignored": 1
        });
        let line: serde_json::Value = serde_json::from_str(&state_line(&state).unwrap()).unwrap();
        assert_eq!(line["type"], "state");
        assert_eq!(line["protocol"], CONTROL_PROTOCOL);
        assert_eq!(line["eq"]["mode"], "smart");
        assert!(line.get("ignored").is_none());

        assert!(state_line(&serde_json::json!([])).is_err());
        assert!(state_line(&serde_json::json!({"player": {}})).is_err());
        let huge = serde_json::json!({"player": {}, "eq": {"x": "y".repeat(MAX_STATE_BYTES)}});
        assert!(state_line(&huge).is_err());
    }

    #[test]
    fn extracts_mpris_extras_from_the_state() {
        let state = serde_json::json!({
            "player": {"volume": 1.4, "shuffle": true, "repeat": "one"},
            "eq": {}
        });
        assert_eq!(
            player_extras(&state),
            Some(PlayerExtras {
                volume: 1.0,
                shuffle: true,
                repeat: RepeatMode::One
            })
        );
        assert_eq!(
            player_extras(&serde_json::json!({"player": {"volume": 1}})),
            None
        );
    }

    #[test]
    fn hello_and_ack_lines() {
        let hello: serde_json::Value = serde_json::from_str(&hello_line("3.4.0")).unwrap();
        assert_eq!(hello["type"], "hello");
        assert_eq!(hello["version"], "3.4.0");
        assert_eq!(hello["protocol"], CONTROL_PROTOCOL);
        assert_eq!(ack_line(&Ok(ControlCommand::Play)), r#"{"type":"ack"}"#);
        assert!(ack_line(&Err("nope".into())).contains("\"error\":\"nope\""));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn socket_path_lives_in_the_runtime_dir() {
        if let Some(runtime) = std::env::var_os("XDG_RUNTIME_DIR") {
            assert_eq!(
                socket::socket_path().unwrap(),
                std::path::PathBuf::from(runtime).join("crate/control.sock")
            );
        }
    }
}
