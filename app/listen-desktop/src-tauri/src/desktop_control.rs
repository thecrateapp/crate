//! Local control channel for desktop widgets (the Ryoku bar's Crate plugin,
//! scripts, launchers).
//!
//! Listen publishes a small state object (volume, shuffle, repeat, equalizer)
//! with `update_desktop_control_state`. On Linux the shell serves it on a Unix
//! socket at `$XDG_RUNTIME_DIR/crate/control.sock` (directory 0700, socket
//! 0600, so only this user can connect), one JSON object per line:
//!
//! - server -> client: `{"type":"hello",...,"commands":[...]}` on connect
//!   (`commands` lists every `cmd` accepted here), then
//!   `{"type":"state","protocol":1,"player":{...},"eq":{...}}` whenever the
//!   state changes, and `{"type":"ack"}` / `{"type":"error","error":"..."}` for
//!   each command line; past 16 connected clients a new one gets only
//!   `{"type":"error","error":"too many clients"}` and is closed;
//! - client -> server: a command such as `{"cmd":"play_pause"}`,
//!   `{"cmd":"eq_mode","mode":"genre"}` or `{"cmd":"set_volume","volume":0.6}`.
//!
//! `search` is acked with a request id and answered later by a `result` line
//! whose items may carry `art` (a cached image path, `desktop_launcher_art.rs`)
//! and, for tracks, `duration`. `queue_item` is acked (or refused) only once
//! Listen has appended the item. `show` with an `item` opens that item's page.
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
    /// Raise the window; with an `item` (a search result's `ref`), open its page.
    Show {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        item: Option<serde_json::Value>,
    },
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
    /// Append a search result (its `ref`) to the end of the play queue.
    QueueItem {
        item: serde_json::Value,
    },
}

/// Every `cmd` the socket accepts, in the order `hello` lists them. A test
/// keeps it in step with `ControlCommand`.
pub const COMMANDS: &[&str] = &[
    "play",
    "pause",
    "play_pause",
    "next",
    "previous",
    "show",
    "seek",
    "set_volume",
    "set_shuffle",
    "set_repeat",
    "eq_enabled",
    "eq_mode",
    "eq_preset",
    "eq_gains",
    "search",
    "play_item",
    "queue_item",
];

pub const MAX_QUERY_CHARS: usize = 200;
const PLAY_KINDS: &[&str] = &["track", "album", "artist"];

/// Where a validated command goes.
#[derive(Clone, Debug, PartialEq)]
pub enum Route {
    /// A tray/menu id handled by `handle_playback_menu_event`.
    Transport(&'static str),
    ShowWindow,
    /// Raise the window, then hand the command to the webview to open a page.
    ShowItem(serde_json::Value),
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
            ControlCommand::PlayItem { item } => ControlCommand::PlayItem {
                item: validated_ref(item)?,
            },
            ControlCommand::QueueItem { item } => ControlCommand::QueueItem {
                item: validated_ref(item)?,
            },
            ControlCommand::Show { item: Some(item) } => ControlCommand::Show {
                item: Some(validated_ref(item)?),
            },
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
            ControlCommand::Show { item: None } => Route::ShowWindow,
            ControlCommand::Show { item: Some(_) } => {
                Route::ShowItem(serde_json::to_value(self).unwrap_or_default())
            }
            other => Route::Webview(serde_json::to_value(other).unwrap_or_default()),
        }
    }
}

/// A search result's `ref`: an object of kind track, album or artist.
fn validated_ref(item: serde_json::Value) -> Result<serde_json::Value, String> {
    let kind = item.get("kind").and_then(|k| k.as_str()).unwrap_or("");
    if !item.is_object() || !PLAY_KINDS.contains(&kind) {
        return Err("item must be a search result ref (kind track, album or artist)".into());
    }
    Ok(item)
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
        "commands": COMMANDS,
    })
    .to_string()
}

pub const MAX_COMMAND_ERROR_CHARS: usize = 200;

/// The ack for a command Listen confirmed (`queue_item`): Listen's error, one
/// line and bounded, or a timeout.
pub fn confirmation_line(outcome: Option<Result<(), String>>) -> String {
    match outcome {
        Some(Ok(())) => serde_json::json!({"type": "ack"}).to_string(),
        Some(Err(error)) => {
            let error: String = error
                .chars()
                .map(|c| if c.is_control() { ' ' } else { c })
                .take(MAX_COMMAND_ERROR_CHARS)
                .collect();
            let error = match error.trim() {
                "" => "Crate could not do that",
                trimmed => trimmed,
            };
            serde_json::json!({"type": "error", "error": error}).to_string()
        }
        None => serde_json::json!({"type": "error", "error": "Crate did not answer in time"})
            .to_string(),
    }
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

/// Keep `duration` only on tracks, as whole seconds.
pub fn normalize_result_items(items: &mut serde_json::Value) {
    for item in items.as_array_mut().into_iter().flatten() {
        let Some(object) = item.as_object_mut() else {
            continue;
        };
        let is_track = object.get("kind").and_then(|k| k.as_str()) == Some("track");
        let seconds = object
            .remove("duration")
            .and_then(|d| d.as_f64())
            .filter(|d| is_track && d.is_finite() && *d >= 0.0);
        if let Some(seconds) = seconds {
            object.insert("duration".into(), (seconds.round() as u64).into());
        }
    }
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
        Route::ShowItem(payload) => {
            crate::show_main_window(app);
            let _ = app.emit(CONTROL_EVENT, payload);
        }
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
pub use socket::{confirm, install, publish_state, reply};

#[cfg(not(target_os = "linux"))]
pub fn publish_state(_line: String) {}

#[cfg(not(target_os = "linux"))]
pub fn reply(_request: u64, _line: String) -> bool {
    false
}

#[cfg(not(target_os = "linux"))]
pub fn confirm(_request: u64, _outcome: Result<(), String>) -> bool {
    false
}

#[cfg(target_os = "linux")]
mod socket {
    use std::{
        collections::HashMap,
        io::{BufRead, BufReader, Read, Write},
        net::Shutdown,
        os::unix::{
            fs::{DirBuilderExt, PermissionsExt},
            net::{UnixListener, UnixStream},
        },
        path::PathBuf,
        sync::{mpsc, Mutex, MutexGuard, OnceLock},
        thread,
        time::{Duration, Instant},
    };

    use super::{ack_line, confirmation_line, hello_line, ControlCommand, MAX_COMMAND_BYTES};

    /// The lines queued for one client. Only that client's writer thread
    /// writes to its socket, one whole line per write, so lines never
    /// interleave, and queueing never waits on the client: the main thread
    /// (state, search replies) only ever does a `try_send`.
    type Outbox = mpsc::SyncSender<String>;

    /// Lines a client may leave unread before it counts as stuck and is dropped.
    const OUTBOX_LINES: usize = 64;
    /// How long the writer waits on a client that stopped reading.
    const WRITE_TIMEOUT: Duration = Duration::from_secs(2);
    /// How long a `search` waits for Listen's result before it is forgotten.
    const REQUEST_TTL: Duration = Duration::from_secs(15);
    /// Clients connected at once; one more is refused with an `error` line.
    /// Widgets, the launcher and the MCP server need a handful; this bounds
    /// the threads and outboxes a runaway script can make Crate hold.
    const MAX_CLIENTS: usize = 16;
    const TOO_MANY_CLIENTS: &str = r#"{"type":"error","error":"too many clients"}"#;
    /// How long a `queue_item` waits for Listen (fetching an album's tracks)
    /// before the client gets an error; below the 3 s clients usually wait.
    const CONFIRM_TIMEOUT: Duration = Duration::from_millis(2500);

    #[derive(Default)]
    struct Hub {
        state: Option<String>,
        clients: HashMap<u64, Outbox>,
        /// open `search` requests: id -> the asking client (and when it asked)
        pending: HashMap<u64, (u64, Instant)>,
        /// commands waiting for Listen to confirm them (`queue_item`)
        confirmations: HashMap<u64, mpsc::Sender<Result<(), String>>>,
        next_request: u64,
        next_client: u64,
    }

    impl Hub {
        fn next_request(&mut self) -> u64 {
            self.next_request += 1;
            self.next_request
        }

        /// Register a client. Its first lines, `hello` and then the latest
        /// state, are queued under the hub lock, so no newer state can land
        /// before them. With `MAX_CLIENTS` already connected it is refused:
        /// it gets only an `error` line, and dropping its outbox closes it.
        fn connect(&mut self, outbox: Outbox, hello: String) -> Option<u64> {
            if self.clients.len() >= MAX_CLIENTS {
                let _ = outbox.try_send(TOO_MANY_CLIENTS.into());
                return None;
            }
            self.next_client += 1;
            let client = self.next_client;
            let greeted = outbox.try_send(hello).is_ok()
                && match &self.state {
                    Some(state) => outbox.try_send(state.clone()).is_ok(),
                    None => true,
                };
            if !greeted {
                return None;
            }
            self.clients.insert(client, outbox);
            Some(client)
        }

        /// Forget searches Listen never answered. Cheap (a handful of
        /// entries), so it runs on every state and every new search rather
        /// than waiting for the next reply.
        fn expire_pending(&mut self) {
            self.pending
                .retain(|_, (_, asked)| asked.elapsed() < REQUEST_TTL);
        }

        /// Forget a client and the searches it is still waiting for. Dropping
        /// its outbox ends its writer once the queued lines are out.
        fn disconnect(&mut self, client: u64) {
            self.clients.remove(&client);
            self.pending.retain(|_, (owner, _)| *owner != client);
        }

        /// Queue a line for one client; a full or closed outbox drops it.
        fn send(&mut self, client: u64, line: String) -> bool {
            let queued = self
                .clients
                .get(&client)
                .is_some_and(|outbox| outbox.try_send(line).is_ok());
            if !queued {
                self.disconnect(client);
            }
            queued
        }

        /// Keep the newest state and queue it for every client; clients that
        /// cannot keep up or went away are dropped.
        fn publish_state(&mut self, line: String) {
            self.expire_pending();
            if self.state.as_deref() == Some(line.as_str()) {
                return;
            }
            let stuck: Vec<u64> = self
                .clients
                .iter()
                .filter(|(_, outbox)| outbox.try_send(line.clone()).is_err())
                .map(|(client, _)| *client)
                .collect();
            for client in stuck {
                self.disconnect(client);
            }
            self.state = Some(line);
        }

        /// Open a search for a client. Its ack is queued before Listen hears
        /// of the search, so the result can never overtake it.
        fn open_search(&mut self, client: u64) -> Option<u64> {
            self.expire_pending();
            let request = self.next_request();
            let ack = serde_json::json!({"type": "ack", "request": request}).to_string();
            if !self.send(client, ack) {
                return None;
            }
            self.pending.insert(request, (client, Instant::now()));
            Some(request)
        }

        /// Queue a search result for the client that asked; false if it is gone.
        fn reply(&mut self, request: u64, line: String) -> bool {
            self.expire_pending();
            match self.pending.remove(&request) {
                Some((client, _)) => self.send(client, line),
                None => false,
            }
        }
    }

    fn hub() -> MutexGuard<'static, Hub> {
        static HUB: OnceLock<Mutex<Hub>> = OnceLock::new();
        HUB.get_or_init(|| Mutex::new(Hub::default()))
            .lock()
            .unwrap_or_else(|p| p.into_inner())
    }

    /// Listen's outcome for a confirmed command; false if nobody waits for it.
    pub fn confirm(request: u64, outcome: Result<(), String>) -> bool {
        let sender = hub().confirmations.remove(&request);
        sender.is_some_and(|sender| sender.send(outcome).is_ok())
    }

    /// Hand `queue_item` to Listen and wait for its outcome.
    fn queue_and_wait(app: &tauri::AppHandle, item: &serde_json::Value) -> String {
        let (sender, receiver) = mpsc::channel();
        let request = {
            let mut hub = hub();
            let request = hub.next_request();
            hub.confirmations.insert(request, sender);
            request
        };
        use tauri::Emitter;
        let emitted = app.emit(
            super::CONTROL_EVENT,
            serde_json::json!({"cmd": "queue_item", "item": item, "request": request}),
        );
        let outcome = match emitted {
            Ok(()) => receiver.recv_timeout(CONFIRM_TIMEOUT).ok(),
            Err(_) => None,
        };
        hub().confirmations.remove(&request);
        confirmation_line(outcome)
    }

    /// Send a search result to the client that asked; false if it is gone.
    pub fn reply(request: u64, line: String) -> bool {
        hub().reply(request, line)
    }

    /// Store the newest state line and queue it for every client.
    pub fn publish_state(line: String) {
        hub().publish_state(line);
    }

    pub fn socket_path() -> Option<PathBuf> {
        let runtime = std::env::var_os("XDG_RUNTIME_DIR")?;
        Some(PathBuf::from(runtime).join("crate").join("control.sock"))
    }

    /// The only writer of a client's socket: each line and its newline go out
    /// in one write. When the outbox closes (the client was dropped) or a write
    /// fails, the socket is shut down, which also ends the client's reader.
    fn spawn_writer(mut stream: UnixStream, lines: mpsc::Receiver<String>) -> std::io::Result<()> {
        thread::Builder::new()
            .name("crate-control-writer".into())
            .spawn(move || {
                for line in lines {
                    let mut bytes = line.into_bytes();
                    bytes.push(b'\n');
                    if stream.write_all(&bytes).is_err() {
                        break;
                    }
                }
                let _ = stream.shutdown(Shutdown::Both);
            })
            .map(|_| ())
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
        let _ = stream.set_write_timeout(Some(WRITE_TIMEOUT));
        let Ok(writer) = stream.try_clone() else {
            return;
        };
        let (outbox, lines) = mpsc::sync_channel(OUTBOX_LINES);
        if spawn_writer(writer, lines).is_err() {
            return;
        }
        let version = app.package_info().version.to_string();
        // refused (too many clients) or gone already: the writer sends what
        // was queued and closes the socket
        let Some(client) = hub().connect(outbox, hello_line(&version)) else {
            return;
        };
        read_commands(&app, client, stream);
        hub().disconnect(client);
    }

    /// One command per line; a line longer than the limit ends the session.
    fn read_commands(app: &tauri::AppHandle, client: u64, stream: UnixStream) {
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
                    hub().send(
                        client,
                        r#"{"type":"error","error":"command too long"}"#.into(),
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
                            let Some(request) = hub().open_search(client) else {
                                break;
                            };
                            use tauri::Emitter;
                            let _ = app.emit(
                                super::CONTROL_EVENT,
                                serde_json::json!({"cmd": "search", "query": query, "request": request}),
                            );
                            continue;
                        }
                        Ok(ControlCommand::QueueItem { item }) => queue_and_wait(app, item),
                        Ok(command) => {
                            super::dispatch(app, command);
                            ack_line(&result)
                        }
                        Err(_) => ack_line(&result),
                    };
                    if !hub().send(client, ack) {
                        break;
                    }
                }
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::sync::Arc;

        fn line_kind(line: &str) -> (String, Option<u64>) {
            let value: serde_json::Value = serde_json::from_str(line)
                .unwrap_or_else(|err| panic!("not one JSON line ({err}): {line:.80}"));
            (
                value["type"].as_str().unwrap_or_default().to_owned(),
                value["request"].as_u64(),
            )
        }

        #[test]
        fn connect_queues_hello_then_the_latest_state() {
            let mut hub = Hub::default();
            hub.publish_state(r#"{"type":"state","n":1}"#.into());
            let (outbox, lines) = mpsc::sync_channel(8);
            let client = hub.connect(outbox, r#"{"type":"hello"}"#.into()).unwrap();
            hub.publish_state(r#"{"type":"state","n":2}"#.into());
            let got: Vec<String> = lines.try_iter().collect();
            assert_eq!(
                got,
                [
                    r#"{"type":"hello"}"#,
                    r#"{"type":"state","n":1}"#,
                    r#"{"type":"state","n":2}"#
                ]
            );
            assert!(hub.clients.contains_key(&client));
        }

        #[test]
        fn a_client_that_stops_reading_is_dropped_without_waiting() {
            let mut hub = Hub::default();
            let (outbox, _lines) = mpsc::sync_channel(2);
            let client = hub.connect(outbox, "{}".into()).unwrap();
            let request = hub.open_search(client).unwrap();
            let started = Instant::now();
            for n in 0..5 {
                hub.publish_state(format!(r#"{{"type":"state","n":{n}}}"#));
            }
            assert!(started.elapsed() < Duration::from_millis(50));
            assert!(hub.clients.is_empty());
            assert!(hub.pending.is_empty());
            assert!(!hub.reply(request, "{}".into()));
        }

        #[test]
        fn disconnect_forgets_the_clients_open_searches() {
            let mut hub = Hub::default();
            let (outbox, _lines) = mpsc::sync_channel(8);
            let client = hub.connect(outbox, "{}".into()).unwrap();
            let request = hub.open_search(client).unwrap();
            hub.disconnect(client);
            assert!(hub.pending.is_empty());
            assert!(!hub.reply(request, "{}".into()));
        }

        #[test]
        fn refuses_clients_past_the_cap_with_an_error_line() {
            let mut hub = Hub::default();
            let mut kept = Vec::new();
            for _ in 0..MAX_CLIENTS {
                let (outbox, lines) = mpsc::sync_channel(8);
                hub.connect(outbox, r#"{"type":"hello"}"#.into()).unwrap();
                kept.push(lines);
            }
            let (outbox, lines) = mpsc::sync_channel(8);
            assert_eq!(hub.connect(outbox, r#"{"type":"hello"}"#.into()), None);
            assert_eq!(hub.clients.len(), MAX_CLIENTS);
            // only the error, then the outbox closes (the writer shuts the socket)
            assert_eq!(lines.recv().unwrap(), TOO_MANY_CLIENTS);
            assert_eq!(line_kind(TOO_MANY_CLIENTS).0, "error");
            assert!(lines.recv().is_err());

            // a slot frees when a client leaves
            let first = *hub.clients.keys().min().unwrap();
            hub.disconnect(first);
            let (outbox, _lines) = mpsc::sync_channel(8);
            assert!(hub.connect(outbox, "{}".into()).is_some());
        }

        #[test]
        fn a_client_whose_greeting_does_not_fit_is_not_registered() {
            let mut hub = Hub::default();
            hub.publish_state(r#"{"type":"state"}"#.into());
            let (outbox, _lines) = mpsc::sync_channel(1);
            assert_eq!(hub.connect(outbox, "{}".into()), None);
            assert!(hub.clients.is_empty());
        }

        /// A search Listen never answered is forgotten on the next state or
        /// search, not only when some other result arrives.
        #[test]
        fn unanswered_searches_expire_without_another_reply() {
            let Some(long_ago) = Instant::now().checked_sub(REQUEST_TTL + Duration::from_secs(1))
            else {
                return; // the monotonic clock started less than a TTL ago
            };
            let mut hub = Hub::default();
            let (outbox, _lines) = mpsc::sync_channel(64);
            let client = hub.connect(outbox, "{}".into()).unwrap();

            hub.pending.insert(1_000, (client, long_ago));
            hub.publish_state(r#"{"type":"state","n":1}"#.into());
            assert!(!hub.pending.contains_key(&1_000), "expired on publish");

            hub.pending.insert(1_001, (client, long_ago));
            // an unchanged state still sweeps
            hub.publish_state(r#"{"type":"state","n":1}"#.into());
            assert!(!hub.pending.contains_key(&1_001), "expired on a repeat");

            hub.pending.insert(1_002, (client, long_ago));
            let fresh = hub.open_search(client).unwrap();
            assert!(!hub.pending.contains_key(&1_002), "expired on search");
            assert!(hub.pending.contains_key(&fresh));
            assert!(!hub.reply(1_002, "{}".into()));
            assert!(hub.reply(fresh, "{}".into()));
        }

        /// States published from several threads race with search results;
        /// the client still reads whole JSON lines, each ack before its result.
        #[test]
        fn racing_states_and_results_reach_the_client_as_whole_lines_in_order() {
            const SEARCHES: u64 = 40;
            let hub = Arc::new(Mutex::new(Hub::default()));
            let (ours, theirs) = UnixStream::pair().unwrap();
            let (outbox, lines) = mpsc::sync_channel(4096);
            spawn_writer(ours, lines).unwrap();
            let client = hub
                .lock()
                .unwrap()
                .connect(outbox, r#"{"type":"hello"}"#.into())
                .unwrap();

            let reader = thread::spawn(move || {
                BufReader::new(theirs)
                    .lines()
                    .map(Result::unwrap)
                    .collect::<Vec<_>>()
            });

            // Lines larger than a socket buffer page make split writes likely.
            let padding = "x".repeat(16 * 1024);
            let publishers: Vec<_> = (0..3)
                .map(|thread_no| {
                    let hub = Arc::clone(&hub);
                    let padding = padding.clone();
                    thread::spawn(move || {
                        for n in 0..30 {
                            let state = serde_json::json!({
                                "type": "state", "t": thread_no, "n": n, "pad": padding
                            });
                            hub.lock().unwrap().publish_state(state.to_string());
                        }
                    })
                })
                .collect();
            let requests: Vec<u64> = (0..SEARCHES)
                .map(|_| hub.lock().unwrap().open_search(client).unwrap())
                .collect();
            let repliers: Vec<_> = requests
                .chunks(10)
                .map(|chunk| {
                    let hub = Arc::clone(&hub);
                    let chunk = chunk.to_vec();
                    let padding = padding.clone();
                    thread::spawn(move || {
                        for request in chunk {
                            let result = serde_json::json!({
                                "type": "result", "request": request, "items": [padding]
                            });
                            assert!(hub.lock().unwrap().reply(request, result.to_string()));
                        }
                    })
                })
                .collect();
            for handle in publishers.into_iter().chain(repliers) {
                handle.join().unwrap();
            }
            hub.lock().unwrap().disconnect(client);

            let received = reader.join().unwrap();
            let kinds: Vec<_> = received.iter().map(|line| line_kind(line)).collect();
            assert_eq!(kinds[0].0, "hello");
            for request in requests {
                let ack = kinds
                    .iter()
                    .position(|kind| *kind == ("ack".into(), Some(request)))
                    .expect("ack");
                let result = kinds
                    .iter()
                    .position(|kind| *kind == ("result".into(), Some(request)))
                    .expect("result");
                assert!(ack < result, "result {request} overtook its ack");
            }
            assert_eq!(kinds.iter().filter(|kind| kind.0 == "state").count(), 90);
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
            (r#"{"cmd":"show","item":null}"#, Route::ShowWindow),
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

    /// One valid line per command; `COMMANDS` must list exactly these.
    const SAMPLES: &[&str] = &[
        r#"{"cmd":"play"}"#,
        r#"{"cmd":"pause"}"#,
        r#"{"cmd":"play_pause"}"#,
        r#"{"cmd":"next"}"#,
        r#"{"cmd":"previous"}"#,
        r#"{"cmd":"show"}"#,
        r#"{"cmd":"seek","position":1}"#,
        r#"{"cmd":"set_volume","volume":0.5}"#,
        r#"{"cmd":"set_shuffle","on":true}"#,
        r#"{"cmd":"set_repeat","mode":"all"}"#,
        r#"{"cmd":"eq_enabled","on":true}"#,
        r#"{"cmd":"eq_mode","mode":"smart"}"#,
        r#"{"cmd":"eq_preset","preset":"rock"}"#,
        r#"{"cmd":"eq_gains","gains":[0,0,0,0,0,0,0,0,0,0]}"#,
        r#"{"cmd":"search","query":"x"}"#,
        r#"{"cmd":"play_item","item":{"kind":"track"}}"#,
        r#"{"cmd":"queue_item","item":{"kind":"album"}}"#,
    ];

    #[test]
    fn hello_lists_every_accepted_command() {
        let hello: serde_json::Value = serde_json::from_str(&hello_line("3.4.0")).unwrap();
        let listed: Vec<&str> = hello["commands"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c.as_str().unwrap())
            .collect();
        assert_eq!(listed, COMMANDS);
        assert!(listed.contains(&"queue_item"));
        let mut sampled = Vec::new();
        for line in SAMPLES {
            let command = ControlCommand::parse(line).unwrap_or_else(|e| panic!("{line}: {e}"));
            let value = serde_json::to_value(&command).unwrap();
            sampled.push(value["cmd"].as_str().unwrap().to_string());
        }
        assert_eq!(sampled, COMMANDS);
    }

    #[test]
    fn queue_item_takes_a_search_ref() {
        let line =
            r#"{"cmd":"queue_item","item":{"kind":"track","track":{"title":"x","artist":"y"}}}"#;
        let command = ControlCommand::parse(line).unwrap();
        assert_eq!(
            command.route(),
            Route::Webview(serde_json::json!({
                "cmd": "queue_item",
                "item": {"kind": "track", "track": {"title": "x", "artist": "y"}}
            }))
        );
        for bad in [
            r#"{"cmd":"queue_item"}"#,
            r#"{"cmd":"queue_item","item":"album"}"#,
            r#"{"cmd":"queue_item","item":{"kind":"playlist"}}"#,
        ] {
            assert!(ControlCommand::parse(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn show_with_an_item_opens_its_page() {
        assert_eq!(
            ControlCommand::parse(r#"{"cmd":"show"}"#).unwrap(),
            ControlCommand::Show { item: None }
        );
        let command = ControlCommand::parse(
            r#"{"cmd":"show","item":{"kind":"artist","artist":{"name":"R"}}}"#,
        )
        .unwrap();
        assert_eq!(
            command.route(),
            Route::ShowItem(serde_json::json!({
                "cmd": "show",
                "item": {"kind": "artist", "artist": {"name": "R"}}
            }))
        );
        assert!(ControlCommand::parse(r#"{"cmd":"show","item":{"kind":"genre"}}"#).is_err());
        assert!(ControlCommand::parse(r#"{"cmd":"show","item":7}"#).is_err());
    }

    #[test]
    fn confirmation_lines() {
        assert_eq!(confirmation_line(Some(Ok(()))), r#"{"type":"ack"}"#);
        let error: serde_json::Value =
            serde_json::from_str(&confirmation_line(Some(Err("queue\nlocked".into())))).unwrap();
        assert_eq!(error["type"], "error");
        assert!(!error["error"].as_str().unwrap().contains('\n'));
        let long: serde_json::Value =
            serde_json::from_str(&confirmation_line(Some(Err("x".repeat(500))))).unwrap();
        assert_eq!(
            long["error"].as_str().unwrap().len(),
            MAX_COMMAND_ERROR_CHARS
        );
        let blank: serde_json::Value =
            serde_json::from_str(&confirmation_line(Some(Err("  ".into())))).unwrap();
        assert_eq!(blank["error"], "Crate could not do that");
        let timeout: serde_json::Value = serde_json::from_str(&confirmation_line(None)).unwrap();
        assert_eq!(timeout["type"], "error");
    }

    #[test]
    fn result_items_keep_whole_second_durations_on_tracks_only() {
        let mut items = serde_json::json!([
            {"kind": "track", "duration": 201.6},
            {"kind": "track", "duration": -1},
            {"kind": "track", "duration": "3:20"},
            {"kind": "album", "duration": 3000},
            {"kind": "track"},
            "x"
        ]);
        normalize_result_items(&mut items);
        assert_eq!(items[0]["duration"], 202);
        assert!(items[1].get("duration").is_none());
        assert!(items[2].get("duration").is_none());
        assert!(items[3].get("duration").is_none());
        assert!(items[4].get("duration").is_none());
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
