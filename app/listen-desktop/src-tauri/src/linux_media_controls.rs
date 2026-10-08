use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    future,
    hash::{Hash, Hasher},
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    thread,
};

use zbus::zvariant::{OwnedObjectPath, OwnedValue, Value};
use zbus::{block_on, connection, interface};

use crate::DesktopMediaSessionPayload;

const MPRIS_BUS_NAME: &str = "org.mpris.MediaPlayer2.crate";
const MPRIS_PATH: &str = "/org/mpris/MediaPlayer2";

static MPRIS_STATE: OnceLock<Arc<Mutex<MprisState>>> = OnceLock::new();
static MPRIS_CONNECTION: OnceLock<zbus::Connection> = OnceLock::new();

#[derive(Clone, Debug, Default, PartialEq)]
struct MprisState {
    media_id: Option<String>,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    artwork: Option<String>,
    is_playing: bool,
    position: f64,
    duration: f64,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct MprisChanges {
    metadata: bool,
    playback_status: bool,
    position: bool,
}

impl MprisState {
    fn from_payload(payload: &DesktopMediaSessionPayload) -> Self {
        Self {
            media_id: clean_optional(payload.media_id.as_deref()),
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
        metadata.insert(
            "mpris:trackid".into(),
            object_path_value(&mpris_track_path(self.media_id.as_deref())),
        );

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

    fn apply(&mut self, updated: Self) -> MprisChanges {
        let changes = MprisChanges {
            metadata: self.media_id != updated.media_id
                || self.title != updated.title
                || self.artist != updated.artist
                || self.album != updated.album
                || self.artwork != updated.artwork
                || self.duration != updated.duration,
            playback_status: self.is_playing != updated.is_playing,
            position: self.position != updated.position,
        };
        *self = updated;
        changes
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
    fn emit_command(&self, command: crate::PlaybackCommand) {
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
        self.emit_command(crate::PlaybackCommand::Next);
    }

    fn previous(&self) {
        self.emit_command(crate::PlaybackCommand::Previous);
    }

    fn pause(&self) {
        self.emit_command(crate::PlaybackCommand::Pause);
    }

    fn play_pause(&self) {
        if self.state().is_playing {
            self.emit_command(crate::PlaybackCommand::Pause);
        } else {
            self.emit_command(crate::PlaybackCommand::Play);
        }
    }

    fn stop(&self) {
        self.emit_command(crate::PlaybackCommand::Pause);
    }

    fn play(&self) {
        self.emit_command(crate::PlaybackCommand::Play);
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
    let updated = MprisState::from_payload(payload);
    let changes = if let Ok(mut state) = state.lock() {
        state.apply(updated)
    } else {
        MprisChanges {
            metadata: true,
            playback_status: true,
            position: true,
        }
    };
    emit_player_properties_changed(changes.metadata, changes.playback_status, changes.position);
}

pub fn update_playback_state(is_playing: bool) {
    let state = MPRIS_STATE
        .get_or_init(|| Arc::new(Mutex::new(MprisState::default())))
        .clone();
    let changed = if let Ok(mut state) = state.lock() {
        let changed = state.is_playing != is_playing;
        state.is_playing = is_playing;
        changed
    } else {
        false
    };
    if changed {
        emit_player_properties_changed(false, true, false);
    }
}

pub fn update_position(payload: &crate::DesktopMediaPosition) {
    let state = MPRIS_STATE
        .get_or_init(|| Arc::new(Mutex::new(MprisState::default())))
        .clone();
    let (duration_changed, position_changed) = if let Ok(mut state) = state.lock() {
        let duration_changed = state.duration != payload.duration;
        let position_changed = state.position != payload.position;
        state.duration = payload.duration;
        state.position = payload.position;
        (duration_changed, position_changed)
    } else {
        (false, false)
    };
    if duration_changed || position_changed {
        emit_player_properties_changed(duration_changed, false, position_changed);
    }
}

pub fn active_artwork_path() -> Option<PathBuf> {
    let state = MPRIS_STATE.get()?.lock().ok()?;
    let artwork = state.artwork.as_deref()?;
    let parsed = tauri::Url::parse(artwork).ok()?;
    let path = parsed.to_file_path().ok()?;
    crate::is_native_desktop_artwork_path(&path).then_some(path)
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

fn emit_player_properties_changed(
    metadata_changed: bool,
    playback_status_changed: bool,
    position_changed: bool,
) {
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
                if playback_status_changed {
                    let _ = player.playback_status_changed(iface.signal_emitter()).await;
                }
                if metadata_changed {
                    let _ = player.metadata_changed(iface.signal_emitter()).await;
                }
                if position_changed {
                    let _ = player.position_changed(iface.signal_emitter()).await;
                }
            },
            "crate_mpris_properties_changed",
        )
        .detach();
}

fn mpris_track_path(media_id: Option<&str>) -> String {
    let Some(media_id) = media_id else {
        return "/org/mpris/MediaPlayer2/track/0".into();
    };
    let mut hasher = DefaultHasher::new();
    media_id.hash(&mut hasher);
    format!("/org/mpris/MediaPlayer2/track/{:016x}", hasher.finish())
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
    use super::{
        mpris_track_path, safe_artwork_url, seconds_to_microseconds, MprisChanges, MprisState,
    };

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
    fn playback_and_position_updates_only_change_their_mpris_properties() {
        let mut state = MprisState {
            media_id: Some("server:track-1".into()),
            title: Some("Song".into()),
            is_playing: true,
            position: 10.0,
            duration: 180.0,
            ..MprisState::default()
        };

        let changes = state.apply(MprisState {
            is_playing: false,
            position: 11.0,
            ..state.clone()
        });

        assert_eq!(
            changes,
            MprisChanges {
                metadata: false,
                playback_status: true,
                position: true,
            }
        );
    }

    #[test]
    fn a_track_change_updates_metadata_without_marking_playback_changed() {
        let state = MprisState {
            media_id: Some("server:track-1".into()),
            title: Some("Song".into()),
            is_playing: true,
            position: 10.0,
            duration: 180.0,
            ..MprisState::default()
        };
        let mut updated = state.clone();
        updated.media_id = Some("server:track-2".into());
        updated.title = Some("Next song".into());
        updated.position = 0.0;

        let mut state = state;
        assert_eq!(
            state.apply(updated),
            MprisChanges {
                metadata: true,
                playback_status: false,
                position: true,
            }
        );
    }

    #[test]
    fn mpris_track_ids_are_stable_and_distinct_per_media_identity() {
        let first = mpris_track_path(Some("server:track-1"));
        assert_eq!(first, mpris_track_path(Some("server:track-1")));
        assert_ne!(first, mpris_track_path(Some("server:track-2")));
    }
}
