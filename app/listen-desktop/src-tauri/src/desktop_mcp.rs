//! `crate-desktop --mcp`: a Model Context Protocol server on stdio that lets a
//! desktop agent (Hermes, Claude Code, ...) drive the running Crate app.
//!
//! It is a thin client: playback state comes from Crate's MPRIS player and the
//! control socket (`desktop_control.rs`), and every tool is one control command.
//! It never starts Crate and never talks to the Crate server itself. Register it
//! in the agent's config, e.g. `claude mcp add crate -- crate-desktop --mcp`.

use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    time::Duration,
};

use serde_json::{json, Value};

const PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

fn socket_path() -> Option<std::path::PathBuf> {
    let runtime = std::env::var_os("XDG_RUNTIME_DIR")?;
    Some(std::path::PathBuf::from(runtime).join("crate/control.sock"))
}

/// One session with the control socket: the latest state, and send-and-ack.
struct Control {
    writer: UnixStream,
    reader: BufReader<UnixStream>,
    state: Option<Value>,
}

impl Control {
    fn connect() -> Result<Control, String> {
        let path = socket_path().ok_or("XDG_RUNTIME_DIR is not set")?;
        let stream = UnixStream::connect(&path).map_err(|_| {
            "Crate is not running (no control socket). Start the Crate app first.".to_string()
        })?;
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .map_err(|e| e.to_string())?;
        let writer = stream.try_clone().map_err(|e| e.to_string())?;
        let mut control = Control {
            writer,
            reader: BufReader::new(stream),
            state: None,
        };
        // hello, then the current state if Listen has published one
        control.read_until(|m| m["type"] == "hello")?;
        control.with_timeout(400, |c| {
            let _ = c.read_until(|m| m["type"] == "state");
        });
        Ok(control)
    }

    fn with_timeout(&mut self, ms: u64, f: impl FnOnce(&mut Control)) {
        let _ = self
            .reader
            .get_ref()
            .set_read_timeout(Some(Duration::from_millis(ms)));
        f(self);
        let _ = self
            .reader
            .get_ref()
            .set_read_timeout(Some(Duration::from_secs(3)));
    }

    fn read_until(&mut self, done: impl Fn(&Value) -> bool) -> Result<Value, String> {
        let mut line = String::new();
        loop {
            line.clear();
            match self.reader.read_line(&mut line) {
                Ok(0) => return Err("Crate closed the control socket".into()),
                Ok(_) => {}
                Err(_) => return Err("Crate did not answer".into()),
            }
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if message["type"] == "state" {
                self.state = Some(message.clone());
            }
            if done(&message) {
                return Ok(message);
            }
        }
    }

    fn send(&mut self, command: &Value) -> Result<(), String> {
        let mut line = command.to_string();
        line.push('\n');
        self.writer
            .write_all(line.as_bytes())
            .map_err(|e| e.to_string())?;
        let reply = self.read_until(|m| m["type"] == "ack" || m["type"] == "error")?;
        if reply["type"] == "error" {
            return Err(reply["error"]
                .as_str()
                .unwrap_or("command failed")
                .to_string());
        }
        Ok(())
    }

    /// `search`: ack with a request id, then the `result` for that request.
    fn search(&mut self, query: &str) -> Result<Value, String> {
        let mut line = json!({"cmd": "search", "query": query}).to_string();
        line.push('\n');
        self.writer
            .write_all(line.as_bytes())
            .map_err(|e| e.to_string())?;
        let ack = self.read_until(|m| m["type"] == "ack" || m["type"] == "error")?;
        if ack["type"] == "error" {
            return Err(ack["error"].as_str().unwrap_or("search failed").to_string());
        }
        let request = ack["request"].clone();
        let result = self.with_result_timeout(|c| {
            c.read_until(|m| m["type"] == "result" && m["request"] == request)
        })?;
        Ok(result["items"].clone())
    }

    fn with_result_timeout<T>(&mut self, f: impl FnOnce(&mut Control) -> T) -> T {
        let _ = self
            .reader
            .get_ref()
            .set_read_timeout(Some(Duration::from_secs(12)));
        let out = f(self);
        let _ = self
            .reader
            .get_ref()
            .set_read_timeout(Some(Duration::from_secs(3)));
        out
    }

    /// Commands change state asynchronously; wait briefly for the update.
    fn settle(&mut self) {
        self.with_timeout(600, |c| {
            let _ = c.read_until(|m| m["type"] == "state");
        });
    }
}

/// Title, artist, album, position and status from Crate's MPRIS player.
fn now_playing() -> Value {
    let read = || -> zbus::Result<Value> {
        let connection = zbus::blocking::Connection::session()?;
        let proxy = zbus::blocking::Proxy::new(
            &connection,
            "org.mpris.MediaPlayer2.crate",
            "/org/mpris/MediaPlayer2",
            "org.mpris.MediaPlayer2.Player",
        )?;
        let status: String = proxy.get_property("PlaybackStatus")?;
        let position: i64 = proxy.get_property("Position").unwrap_or(0);
        let metadata: std::collections::HashMap<String, zbus::zvariant::OwnedValue> =
            proxy.get_property("Metadata")?;
        let text = |key: &str| {
            metadata
                .get(key)
                .and_then(|v| String::try_from(v.clone()).ok())
        };
        let artists = metadata
            .get("xesam:artist")
            .and_then(|v| Vec::<String>::try_from(v.clone()).ok())
            .unwrap_or_default();
        let length = metadata
            .get("mpris:length")
            .and_then(|v| i64::try_from(v.clone()).ok())
            .unwrap_or(0);
        Ok(json!({
            "status": status,
            "title": text("xesam:title"),
            "artist": artists.join(", "),
            "album": text("xesam:album"),
            "position_seconds": position / 1_000_000,
            "duration_seconds": length / 1_000_000,
        }))
    };
    read().unwrap_or_else(|_| json!({"status": "not running"}))
}

fn tools() -> Value {
    let none = json!({"type": "object", "properties": {}, "additionalProperties": false});
    json!([
        {"name": "now_playing", "description": "What Crate is playing: track, artist, album, position, play state, shuffle, repeat and the equalizer.", "inputSchema": none},
        {"name": "play_pause", "description": "Toggle play/pause in Crate.", "inputSchema": none},
        {"name": "next_track", "description": "Skip to the next track.", "inputSchema": none},
        {"name": "previous_track", "description": "Go to the previous track.", "inputSchema": none},
        {"name": "seek", "description": "Jump to a position in the current track.", "inputSchema": {
            "type": "object", "properties": {"seconds": {"type": "number", "minimum": 0}}, "required": ["seconds"], "additionalProperties": false}},
        {"name": "set_shuffle", "description": "Turn shuffle on or off.", "inputSchema": {
            "type": "object", "properties": {"on": {"type": "boolean"}}, "required": ["on"], "additionalProperties": false}},
        {"name": "set_repeat", "description": "Repeat mode: off, all (the queue) or one (the track).", "inputSchema": {
            "type": "object", "properties": {"mode": {"type": "string", "enum": ["off", "all", "one"]}}, "required": ["mode"], "additionalProperties": false}},
        {"name": "set_equalizer", "description": "Change Crate's equalizer: turn it on/off, pick a mode (smart: the server's curve for the track; genre: the track's genre preset; adaptive: from audio analysis; manual), or apply a named preset such as rock, jazz, shoegaze, post_rock.", "inputSchema": {
            "type": "object", "properties": {
                "enabled": {"type": "boolean"},
                "mode": {"type": "string", "enum": ["smart", "genre", "adaptive", "manual"]},
                "preset": {"type": "string"}
            }, "additionalProperties": false}},
        {"name": "search_library", "description": "Search the Crate library (artists, albums, tracks). Each result has a `ref`; pass it to play_result to play it.", "inputSchema": {
            "type": "object", "properties": {"query": {"type": "string", "minLength": 1, "maxLength": 200}}, "required": ["query"], "additionalProperties": false}},
        {"name": "play_result", "description": "Play a search_library result: a track plays alone, an album in order, an artist its top tracks.", "inputSchema": {
            "type": "object", "properties": {"ref": {"type": "object", "description": "The `ref` of a search_library result, unchanged."}}, "required": ["ref"], "additionalProperties": false}},
        {"name": "show_crate", "description": "Bring the Crate window to the front.", "inputSchema": none}
    ])
}

fn text_result(text: String, is_error: bool) -> Value {
    json!({"content": [{"type": "text", "text": text}], "isError": is_error})
}

fn status_text(control: &Control) -> String {
    let mut out = now_playing();
    if let Some(state) = &control.state {
        out["shuffle"] = state["player"]["shuffle"].clone();
        out["repeat"] = state["player"]["repeat"].clone();
        out["equalizer"] = json!({
            "enabled": state["eq"]["enabled"],
            "mode": state["eq"]["mode"],
            "preset": state["eq"]["preset"],
            "detail": state["eq"]["detail"],
            "gains_db": state["eq"]["gains"],
            "bands": state["eq"]["bands"],
            "presets": state["eq"]["presets"],
        });
    }
    serde_json::to_string_pretty(&out).unwrap_or_default()
}

/// The control commands a tool call maps to.
fn commands_for(name: &str, args: &Value) -> Result<Vec<Value>, String> {
    let need = |key: &str| args.get(key).cloned().ok_or(format!("missing `{key}`"));
    Ok(match name {
        "now_playing" => vec![],
        "play_pause" => vec![json!({"cmd": "play_pause"})],
        "next_track" => vec![json!({"cmd": "next"})],
        "previous_track" => vec![json!({"cmd": "previous"})],
        "show_crate" => vec![json!({"cmd": "show"})],
        "play_result" => vec![json!({"cmd": "play_item", "item": need("ref")?})],
        "seek" => vec![json!({"cmd": "seek", "position": need("seconds")?})],
        "set_shuffle" => vec![json!({"cmd": "set_shuffle", "on": need("on")?})],
        "set_repeat" => vec![json!({"cmd": "set_repeat", "mode": need("mode")?})],
        "set_equalizer" => {
            let mut out = vec![];
            if let Some(on) = args.get("enabled") {
                out.push(json!({"cmd": "eq_enabled", "on": on}));
            }
            if let Some(mode) = args.get("mode") {
                out.push(json!({"cmd": "eq_mode", "mode": mode}));
            }
            if let Some(preset) = args.get("preset") {
                out.push(json!({"cmd": "eq_preset", "preset": preset}));
            }
            if out.is_empty() {
                return Err("pass enabled, mode or preset".into());
            }
            out
        }
        other => return Err(format!("unknown tool `{other}`")),
    })
}

fn call_tool(name: &str, args: &Value) -> Value {
    if name == "search_library" {
        let Some(query) = args["query"].as_str() else {
            return text_result("missing `query`".into(), true);
        };
        return match Control::connect().and_then(|mut c| c.search(query)) {
            Ok(items) => text_result(
                serde_json::to_string_pretty(&items).unwrap_or_default(),
                false,
            ),
            Err(err) => text_result(err, true),
        };
    }
    let commands = match commands_for(name, args) {
        Ok(commands) => commands,
        Err(err) => return text_result(err, true),
    };
    let mut control = match Control::connect() {
        Ok(control) => control,
        Err(err) => return text_result(err, true),
    };
    for command in &commands {
        if let Err(err) = control.send(command) {
            return text_result(err, true);
        }
    }
    if !commands.is_empty() {
        control.settle();
    }
    text_result(status_text(&control), false)
}

fn handle(request: &Value) -> Option<Value> {
    let id = request.get("id").cloned();
    let method = request["method"].as_str().unwrap_or("");
    let result = match method {
        "initialize" => {
            let asked = request["params"]["protocolVersion"].as_str().unwrap_or("");
            let version = if PROTOCOL_VERSIONS.contains(&asked) {
                asked
            } else {
                PROTOCOL_VERSIONS[0]
            };
            json!({
                "protocolVersion": version,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "crate", "version": env!("CARGO_PKG_VERSION")},
                "instructions": "Controls the Crate music app running on this desktop: now playing, transport, shuffle/repeat and the equalizer."
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({"tools": tools()}),
        "tools/call" => call_tool(
            request["params"]["name"].as_str().unwrap_or(""),
            &request["params"]["arguments"].clone(),
        ),
        // notifications (no id) need no answer
        _ if id.is_none() => return None,
        _ => {
            return Some(json!({"jsonrpc": "2.0", "id": id,
                "error": {"code": -32601, "message": format!("method not found: {method}")}}))
        }
    };
    id.map(|id| json!({"jsonrpc": "2.0", "id": id, "result": result}))
}

// ---- `crate-desktop --launcher`: a rofi-script provider ---------------------
//
// Ryoku's launcher (and rofi) run it as `<keyword> <query>`: pass 1 gets the
// query in ROFI_INFO (ROFI_RETV=0) and prints one row per result as
// `text\0icon\x1f<name>\x1finfo\x1f<ref json>`; picking a row runs it again with
// ROFI_RETV=1 and that row's info, and the result plays.

const START_INFO: &str = "__start__";

fn row_text(value: &str) -> String {
    value
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

fn icon_for(kind: &str) -> &'static str {
    match kind {
        "track" => "audio-x-generic",
        "album" => "media-optical-cd-audio",
        "artist" => "avatar-default",
        _ => crate::linux_desktop_profile::LINUX_APP_ID,
    }
}

/// Rows for pass 1, from `search` result items.
fn launcher_rows(items: &Value) -> String {
    let mut out = String::new();
    for item in items.as_array().into_iter().flatten() {
        let (Some(title), Some(kind)) = (item["title"].as_str(), item["kind"].as_str()) else {
            continue;
        };
        let subtitle = item["subtitle"].as_str().unwrap_or("");
        let text = if subtitle.is_empty() {
            row_text(title)
        } else {
            format!("{} · {}", row_text(title), row_text(subtitle))
        };
        out.push_str(&format!(
            "{text}\0icon\x1f{}\x1finfo\x1f{}\n",
            icon_for(kind),
            item["ref"]
        ));
    }
    out
}

pub fn launcher() {
    let retv = std::env::var("ROFI_RETV").unwrap_or_default();
    let info = std::env::var("ROFI_INFO").unwrap_or_default();
    if retv == "1" {
        if info == START_INFO {
            if let Ok(exe) = std::env::current_exe() {
                let _ = std::process::Command::new(exe).spawn();
            }
            return;
        }
        if let Ok(item) = serde_json::from_str::<Value>(&info) {
            if let Ok(mut control) = Control::connect() {
                let _ = control.send(&json!({"cmd": "play_item", "item": item}));
            }
        }
        return;
    }
    let query = info.trim();
    if query.is_empty() {
        return;
    }
    match Control::connect() {
        Ok(mut control) => {
            if let Ok(items) = control.search(query) {
                print!("{}", launcher_rows(&items));
            }
        }
        Err(_) => print!(
            "Crate is not running: start it\0icon\x1f{}\x1finfo\x1f{START_INFO}\n",
            crate::linux_desktop_profile::LINUX_APP_ID
        ),
    }
}

/// Serve MCP on stdin/stdout until stdin closes.
pub fn serve_stdio() {
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(request) => handle(&request),
            Err(_) => Some(json!({"jsonrpc": "2.0", "id": null,
                "error": {"code": -32700, "message": "parse error"}})),
        };
        if let Some(response) = response {
            if writeln!(stdout, "{response}").is_err() || stdout.flush().is_err() {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launcher_rows_follow_the_rofi_script_format() {
        let items = json!([
            {"kind": "album", "title": "Pronto", "subtitle": "Repion · 2024", "ref": {"kind": "album", "album": {"album": "Pronto"}}},
            {"kind": "track", "title": "Bad\nTitle", "subtitle": "", "ref": {"kind": "track"}},
            {"kind": "artist"}
        ]);
        let rows = launcher_rows(&items);
        let lines: Vec<_> = rows.lines().collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(
            lines[0],
            "Pronto · Repion · 2024\0icon\x1fmedia-optical-cd-audio\x1finfo\x1f{\"album\":{\"album\":\"Pronto\"},\"kind\":\"album\"}"
        );
        assert!(lines[1].starts_with("Bad Title\0icon\x1faudio-x-generic"));
    }

    #[test]
    fn negotiates_the_protocol_version() {
        let reply = handle(&json!({"jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-03-26"}}))
        .unwrap();
        assert_eq!(reply["result"]["protocolVersion"], "2025-03-26");
        let reply = handle(&json!({"jsonrpc": "2.0", "id": 2, "method": "initialize",
            "params": {"protocolVersion": "1999-01-01"}}))
        .unwrap();
        assert_eq!(reply["result"]["protocolVersion"], PROTOCOL_VERSIONS[0]);
        assert!(reply["result"]["capabilities"]["tools"].is_object());
    }

    #[test]
    fn lists_tools_and_ignores_notifications() {
        let reply = handle(&json!({"jsonrpc": "2.0", "id": 3, "method": "tools/list"})).unwrap();
        let names: Vec<_> = reply["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_string())
            .collect();
        assert!(names.contains(&"now_playing".to_string()));
        assert!(names.contains(&"set_equalizer".to_string()));
        assert!(names.contains(&"search_library".to_string()));
        assert!(names.contains(&"play_result".to_string()));
        assert!(
            handle(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"})).is_none()
        );
        let unknown =
            handle(&json!({"jsonrpc": "2.0", "id": 4, "method": "resources/list"})).unwrap();
        assert_eq!(unknown["error"]["code"], -32601);
    }

    #[test]
    fn maps_tools_to_control_commands() {
        assert_eq!(
            commands_for("play_pause", &json!({})).unwrap(),
            vec![json!({"cmd": "play_pause"})]
        );
        assert_eq!(
            commands_for("seek", &json!({"seconds": 30})).unwrap(),
            vec![json!({"cmd": "seek", "position": 30})]
        );
        assert_eq!(
            commands_for("set_equalizer", &json!({"enabled": true, "preset": "jazz"})).unwrap(),
            vec![
                json!({"cmd": "eq_enabled", "on": true}),
                json!({"cmd": "eq_preset", "preset": "jazz"})
            ]
        );
        assert!(commands_for("set_equalizer", &json!({})).is_err());
        assert!(commands_for("seek", &json!({})).is_err());
        assert!(commands_for("rm_rf", &json!({})).is_err());
        // every mapped command is one the control socket accepts
        for (name, args) in [
            ("next_track", json!({})),
            ("previous_track", json!({})),
            ("show_crate", json!({})),
            (
                "play_result",
                json!({"ref": {"kind": "track", "track": {"id": "t", "title": "x"}}}),
            ),
            ("set_shuffle", json!({"on": true})),
            ("set_repeat", json!({"mode": "one"})),
            (
                "set_equalizer",
                json!({"enabled": false, "mode": "genre", "preset": "rock"}),
            ),
        ] {
            for command in commands_for(name, &args).unwrap() {
                assert!(
                    crate::desktop_control::ControlCommand::parse(&command.to_string()).is_ok(),
                    "{command}"
                );
            }
        }
    }
}
