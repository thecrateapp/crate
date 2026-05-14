use std::{
    collections::hash_map::DefaultHasher,
    collections::HashMap,
    env, fs, future,
    hash::{Hash, Hasher},
    io,
    os::unix::ffi::OsStrExt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    thread,
};

use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};
use zbus::{block_on, connection, interface};

use crate::DesktopMediaSessionPayload;

const MPRIS_BUS_NAME: &str = "org.mpris.MediaPlayer2.crate";
const MPRIS_PATH: &str = "/org/mpris/MediaPlayer2";
const TRACK_PATH: &str = "/org/mpris/MediaPlayer2/track/0";
const MAX_ARTWORK_BYTES: usize = 8 * 1024 * 1024;

static MPRIS_STATE: OnceLock<Arc<Mutex<MprisState>>> = OnceLock::new();
static MPRIS_CONNECTION: OnceLock<zbus::Connection> = OnceLock::new();

#[derive(Clone, Debug, Default)]
struct MprisState {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    artwork: Option<String>,
    is_playing: bool,
    position: f64,
    duration: f64,
}

impl MprisState {
    fn from_payload(payload: &DesktopMediaSessionPayload) -> Self {
        Self {
            title: clean_optional(payload.title.as_deref()),
            artist: clean_optional(payload.artist.as_deref()),
            album: clean_optional(payload.album.as_deref()),
            artwork: clean_optional(payload.artwork.as_deref()),
            is_playing: payload.is_playing,
            position: payload.position,
            duration: payload.duration,
        }
    }

    fn playback_status(&self) -> &'static str {
        if self.title.is_none() {
            "Stopped"
        } else if self.is_playing {
            "Playing"
        } else {
            "Paused"
        }
    }

    fn metadata(&self) -> HashMap<String, OwnedValue> {
        let mut metadata = HashMap::new();
        metadata.insert("mpris:trackid".into(), object_path_value(TRACK_PATH));

        if let Some(title) = self.title.as_deref() {
            metadata.insert("xesam:title".into(), string_value(title));
        }
        if let Some(artist) = self.artist.as_deref() {
            metadata.insert(
                "xesam:artist".into(),
                string_array_value(vec![artist.to_string()]),
            );
        }
        if let Some(album) = self.album.as_deref() {
            metadata.insert("xesam:album".into(), string_value(album));
        }
        if self.duration.is_finite() && self.duration > 0.0 {
            metadata.insert(
                "mpris:length".into(),
                seconds_to_microseconds(self.duration).into(),
            );
        }
        if let Some(art_url) = self.artwork.as_deref().and_then(safe_artwork_url) {
            metadata.insert("mpris:artUrl".into(), string_value(&art_url));
        }

        metadata
    }
}

struct MprisRoot {
    app: tauri::AppHandle,
}

#[interface(interface = "org.mpris.MediaPlayer2")]
impl MprisRoot {
    fn raise(&self) {
        crate::show_main_window(&self.app);
    }

    fn quit(&self) {
        self.app.exit(0);
    }

    #[zbus(property)]
    fn can_quit(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn fullscreen(&self) -> bool {
        false
    }

    #[zbus(property)]
    fn can_set_fullscreen(&self) -> bool {
        false
    }

    #[zbus(property)]
    fn can_raise(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn has_track_list(&self) -> bool {
        false
    }

    #[zbus(property)]
    fn identity(&self) -> String {
        "Crate".into()
    }

    #[zbus(property)]
    fn desktop_entry(&self) -> String {
        "app.cratemusic.crate.desktop".into()
    }

    #[zbus(property)]
    fn supported_uri_schemes(&self) -> Vec<String> {
        vec!["file".into(), "http".into(), "https".into()]
    }

    #[zbus(property)]
    fn supported_mime_types(&self) -> Vec<String> {
        vec![
            "audio/aac".into(),
            "audio/flac".into(),
            "audio/mpeg".into(),
            "audio/ogg".into(),
            "audio/wav".into(),
            "audio/x-m4a".into(),
        ]
    }
}

struct MprisPlayer {
    app: tauri::AppHandle,
    state: Arc<Mutex<MprisState>>,
}

impl MprisPlayer {
    fn emit_command(&self, command: &str) {
        crate::emit_system_media_command(&self.app, command);
    }

    fn state(&self) -> MprisState {
        self.state
            .lock()
            .map(|state| state.clone())
            .unwrap_or_default()
    }
}

#[interface(interface = "org.mpris.MediaPlayer2.Player")]
impl MprisPlayer {
    fn next(&self) {
        self.emit_command("next");
    }

    fn previous(&self) {
        self.emit_command("previous");
    }

    fn pause(&self) {
        self.emit_command("pause");
    }

    fn play_pause(&self) {
        if self.state().is_playing {
            self.emit_command("pause");
        } else {
            self.emit_command("play");
        }
    }

    fn stop(&self) {
        self.emit_command("pause");
    }

    fn play(&self) {
        self.emit_command("play");
    }

    fn seek(&self, _offset: i64) {}

    fn set_position(&self, _track_id: OwnedObjectPath, _position: i64) {}

    fn open_uri(&self, _uri: &str) {}

    #[zbus(property)]
    fn playback_status(&self) -> String {
        self.state().playback_status().into()
    }

    #[zbus(property)]
    fn loop_status(&self) -> String {
        "None".into()
    }

    #[zbus(property)]
    fn set_loop_status(&self, _value: String) {}

    #[zbus(property)]
    fn rate(&self) -> f64 {
        1.0
    }

    #[zbus(property)]
    fn set_rate(&self, _value: f64) {}

    #[zbus(property)]
    fn shuffle(&self) -> bool {
        false
    }

    #[zbus(property)]
    fn set_shuffle(&self, _value: bool) {}

    #[zbus(property)]
    fn metadata(&self) -> HashMap<String, OwnedValue> {
        self.state().metadata()
    }

    #[zbus(property)]
    fn volume(&self) -> f64 {
        1.0
    }

    #[zbus(property)]
    fn set_volume(&self, _value: f64) {}

    #[zbus(property)]
    fn position(&self) -> i64 {
        seconds_to_microseconds(self.state().position)
    }

    #[zbus(property)]
    fn minimum_rate(&self) -> f64 {
        1.0
    }

    #[zbus(property)]
    fn maximum_rate(&self) -> f64 {
        1.0
    }

    #[zbus(property)]
    fn can_go_next(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_go_previous(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_play(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_pause(&self) -> bool {
        true
    }

    #[zbus(property)]
    fn can_seek(&self) -> bool {
        false
    }

    #[zbus(property)]
    fn can_control(&self) -> bool {
        true
    }
}

pub fn install(app: &tauri::App) {
    let state = MPRIS_STATE
        .get_or_init(|| Arc::new(Mutex::new(MprisState::default())))
        .clone();
    let app = app.handle().clone();

    thread::spawn(move || {
        if let Err(err) = block_on(run_mpris_server(app, state)) {
            eprintln!("failed to start Crate MPRIS integration: {err}");
        }
    });
}

pub fn update_now_playing(payload: &DesktopMediaSessionPayload) {
    let state = MPRIS_STATE
        .get_or_init(|| Arc::new(Mutex::new(MprisState::default())))
        .clone();
    if let Ok(mut state) = state.lock() {
        *state = MprisState::from_payload(payload);
    }
    emit_player_properties_changed();
}

pub fn cache_artwork(
    cache_key: &str,
    bytes: &[u8],
    mime_type: Option<&str>,
) -> io::Result<Option<String>> {
    if bytes.is_empty() || bytes.len() > MAX_ARTWORK_BYTES {
        return Ok(None);
    }

    let Some(cache_home) = xdg_cache_home() else {
        return Ok(None);
    };
    let extension = artwork_extension(mime_type, cache_key);
    let cache_path = cache_home.join("crate").join("mpris-artwork").join(format!(
        "{}.{}",
        artwork_cache_id(cache_key, bytes),
        extension
    ));

    write_if_changed(&cache_path, bytes)?;
    Ok(Some(file_uri_for_path(&cache_path)))
}

async fn run_mpris_server(
    app: tauri::AppHandle,
    state: Arc<Mutex<MprisState>>,
) -> zbus::Result<()> {
    let connection = connection::Builder::session()?
        .name(MPRIS_BUS_NAME)?
        .serve_at(MPRIS_PATH, MprisRoot { app: app.clone() })?
        .serve_at(MPRIS_PATH, MprisPlayer { app, state })?
        .build()
        .await?;

    let _ = MPRIS_CONNECTION.set(connection);
    future::pending::<()>().await;
    Ok(())
}

fn emit_player_properties_changed() {
    let Some(connection) = MPRIS_CONNECTION.get().cloned() else {
        return;
    };

    connection
        .clone()
        .executor()
        .spawn(
            async move {
                let Ok(iface) = connection
                    .object_server()
                    .interface::<_, MprisPlayer>(MPRIS_PATH)
                    .await
                else {
                    return;
                };
                let player = iface.get().await;
                let _ = player.playback_status_changed(iface.signal_emitter()).await;
                let _ = player.metadata_changed(iface.signal_emitter()).await;
                let _ = player.position_changed(iface.signal_emitter()).await;
            },
            "crate_mpris_properties_changed",
        )
        .detach();
}

fn clean_optional(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn safe_artwork_url(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.contains("token=") || value.contains("access_token=") {
        return None;
    }

    if value.starts_with("file://") {
        Some(value.to_string())
    } else {
        None
    }
}

fn xdg_cache_home() -> Option<PathBuf> {
    if let Some(value) = env::var_os("XDG_CACHE_HOME").filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(value));
    }

    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .map(|home| home.join(".cache"))
}

fn artwork_cache_id(cache_key: &str, bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    cache_key.hash(&mut hasher);
    bytes.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn artwork_extension(mime_type: Option<&str>, source: &str) -> &'static str {
    let mime = mime_type
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .unwrap_or_default()
        .to_ascii_lowercase();

    match mime.as_str() {
        "image/jpeg" | "image/jpg" => return "jpg",
        "image/png" => return "png",
        "image/webp" => return "webp",
        "image/gif" => return "gif",
        _ => {}
    }

    let source_without_query = source
        .split_once('?')
        .map(|(path, _)| path)
        .unwrap_or(source);
    let source_without_query = source_without_query
        .split_once('#')
        .map(|(path, _)| path)
        .unwrap_or(source_without_query);
    let extension = Path::new(source_without_query)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase);

    match extension.as_deref() {
        Some("jpg" | "jpeg") => "jpg",
        Some("png") => "png",
        Some("webp") => "webp",
        Some("gif") => "gif",
        _ => "jpg",
    }
}

fn file_uri_for_path(path: &Path) -> String {
    let path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("/"))
            .join(path)
    };
    let mut uri = String::from("file://");
    for byte in path.as_os_str().as_bytes() {
        match *byte {
            b'/' => uri.push('/'),
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                uri.push(*byte as char)
            }
            value => uri.push_str(&format!("%{value:02X}")),
        }
    }
    uri
}

fn write_if_changed(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if fs::read(path).is_ok_and(|existing| existing == bytes) {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, bytes)
}

fn seconds_to_microseconds(seconds: f64) -> i64 {
    if !seconds.is_finite() || seconds <= 0.0 {
        return 0;
    }

    (seconds * 1_000_000.0).round().min(i64::MAX as f64) as i64
}

fn string_value(value: &str) -> OwnedValue {
    Value::from(value.to_string())
        .try_into()
        .expect("strings are valid D-Bus values")
}

fn string_array_value(value: Vec<String>) -> OwnedValue {
    Value::from(value)
        .try_into()
        .expect("string arrays are valid D-Bus values")
}

fn object_path_value(value: &str) -> OwnedValue {
    Value::from(OwnedObjectPath::try_from(value).expect("static object path is valid"))
        .try_into()
        .expect("object paths are valid D-Bus values")
}

#[cfg(test)]
mod tests {
    use super::{artwork_extension, file_uri_for_path, safe_artwork_url, seconds_to_microseconds};

    #[test]
    fn artwork_urls_do_not_leak_tokens_over_dbus() {
        assert_eq!(
            safe_artwork_url("file:///tmp/crate-cover.png").as_deref(),
            Some("file:///tmp/crate-cover.png"),
        );
        assert!(safe_artwork_url("https://api.example/cover.jpg?token=secret").is_none());
        assert!(safe_artwork_url("https://api.example/cover.jpg?access_token=secret").is_none());
    }

    #[test]
    fn mpris_times_are_microseconds() {
        assert_eq!(seconds_to_microseconds(1.5), 1_500_000);
        assert_eq!(seconds_to_microseconds(f64::NAN), 0);
        assert_eq!(seconds_to_microseconds(-1.0), 0);
    }

    #[test]
    fn artwork_cache_paths_are_file_uris() {
        assert_eq!(
            file_uri_for_path(std::path::Path::new("/tmp/crate cover.png")),
            "file:///tmp/crate%20cover.png",
        );
    }

    #[test]
    fn artwork_extension_prefers_mime_type_without_tokens() {
        assert_eq!(
            artwork_extension(
                Some("image/png; charset=binary"),
                "https://api.example/cover.jpg?token=secret",
            ),
            "png",
        );
        assert_eq!(
            artwork_extension(None, "https://api.example/cover.webp?token=secret"),
            "webp",
        );
    }
}
