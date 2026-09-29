use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        OnceLock,
    },
};

use tauri::Manager;
use windows::core::{Result as WinResult, HSTRING};
use windows::Foundation::{TimeSpan, TypedEventHandler, Uri};
use windows::Media::{
    MediaPlaybackStatus, MediaPlaybackType, SystemMediaTransportControls,
    SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs,
    SystemMediaTransportControlsDisplayUpdater, SystemMediaTransportControlsTimelineProperties,
};
use windows::Storage::StorageFile;
use windows::Storage::Streams::RandomAccessStreamReference;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;

use crate::{DesktopMediaPosition, DesktopMediaSessionPayload, PlaybackCommand};

// 100-nanosecond ticks per second, the unit windows::Foundation::TimeSpan
// uses for every SMTC timeline property.
const TIMESPAN_TICKS_PER_SECOND: i64 = 10_000_000;

static MEDIA_APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
static SMTC: OnceLock<SystemMediaTransportControls> = OnceLock::new();
static THUMBNAIL_REQUEST: AtomicU64 = AtomicU64::new(0);

pub fn install(app: &tauri::App) {
    let _ = MEDIA_APP_HANDLE.set(app.handle().clone());

    let Some(window) = app.get_webview_window("main") else {
        eprintln!("Crate SMTC init failed: no main webview window");
        return;
    };
    let Ok(hwnd) = window.hwnd() else {
        eprintln!("Crate SMTC init failed: could not read window HWND");
        return;
    };
    let smtc = match create_smtc(hwnd) {
        Ok(smtc) => smtc,
        Err(err) => {
            eprintln!("Crate SMTC init failed: {err}");
            return;
        }
    };

    let _ = smtc.SetIsEnabled(true);
    let _ = smtc.SetIsPlayEnabled(true);
    let _ = smtc.SetIsPauseEnabled(true);
    let _ = smtc.SetIsNextEnabled(true);
    let _ = smtc.SetIsPreviousEnabled(true);

    let _ = smtc.ButtonPressed(&TypedEventHandler::<
        SystemMediaTransportControls,
        SystemMediaTransportControlsButtonPressedEventArgs,
    >::new(|_sender, args| {
        let Some(args) = args.as_ref() else {
            return Ok(());
        };
        if let Ok(button) = args.Button() {
            handle_button(button);
        }
        Ok(())
    }));

    let _ = SMTC.set(smtc);
}

pub fn update_now_playing(payload: &DesktopMediaSessionPayload) {
    let thumbnail_request = next_thumbnail_request_id();
    let Some(smtc) = SMTC.get() else {
        return;
    };

    let Some(title) = non_empty(payload.title.as_deref()) else {
        let _ = smtc.SetPlaybackStatus(MediaPlaybackStatus::Closed);
        if let Ok(updater) = smtc.DisplayUpdater() {
            let _ = updater.ClearAll();
            let _ = updater.Update();
        }
        return;
    };

    if let Ok(updater) = smtc.DisplayUpdater() {
        // Clear stale fields from the previous track first — SMTC keeps
        // whatever was last set, so a track with no artist/album/artwork
        // would otherwise still show the previous track's values instead
        // of blank ones.
        let _ = updater.ClearAll();
        let _ = updater.SetType(MediaPlaybackType::Music);
        if let Ok(music) = updater.MusicProperties() {
            let _ = music.SetTitle(&HSTRING::from(title));
            if let Some(artist) = non_empty(payload.artist.as_deref()) {
                let _ = music.SetArtist(&HSTRING::from(artist));
            }
            if let Some(album) = non_empty(payload.album.as_deref()) {
                let _ = music.SetAlbumTitle(&HSTRING::from(album));
            }
        }
        if let Some(artwork) = non_empty(payload.artwork.as_deref()) {
            set_thumbnail(&updater, artwork, thumbnail_request);
        }
        let _ = updater.Update();
    }

    let _ = smtc.SetPlaybackStatus(if payload.is_playing {
        MediaPlaybackStatus::Playing
    } else {
        MediaPlaybackStatus::Paused
    });

    update_timeline(smtc, payload.position, payload.duration);
    update_playback_rate(smtc, payload.is_playing.then_some(1.0).unwrap_or(0.0));
}

pub fn update_playback_state(is_playing: bool) {
    let Some(smtc) = SMTC.get() else {
        return;
    };
    let _ = smtc.SetPlaybackStatus(if is_playing {
        MediaPlaybackStatus::Playing
    } else {
        MediaPlaybackStatus::Paused
    });
    update_playback_rate(smtc, if is_playing { 1.0 } else { 0.0 });
}

pub fn update_position(payload: &DesktopMediaPosition) {
    let Some(smtc) = SMTC.get() else {
        return;
    };
    update_timeline(smtc, payload.position, payload.duration);
    update_playback_rate(smtc, payload.playback_rate);
}

fn create_smtc(hwnd: HWND) -> WinResult<SystemMediaTransportControls> {
    let interop: ISystemMediaTransportControlsInterop = windows::core::factory::<
        SystemMediaTransportControls,
        ISystemMediaTransportControlsInterop,
    >()?;
    unsafe { interop.GetForWindow(hwnd) }
}

fn handle_button(button: SystemMediaTransportControlsButton) {
    let command = match button {
        SystemMediaTransportControlsButton::Play => PlaybackCommand::Play,
        SystemMediaTransportControlsButton::Pause => PlaybackCommand::Pause,
        SystemMediaTransportControlsButton::Next => PlaybackCommand::Next,
        SystemMediaTransportControlsButton::Previous => PlaybackCommand::Previous,
        _ => return,
    };
    if let Some(app) = MEDIA_APP_HANDLE.get() {
        crate::emit_system_media_command(app, command);
    }
}

fn set_thumbnail(
    updater: &SystemMediaTransportControlsDisplayUpdater,
    artwork_url: &str,
    request_id: u64,
) {
    match parse_thumbnail_source(artwork_url) {
        Some(ThumbnailSource::Remote(uri)) => {
            let Ok(uri) = Uri::CreateUri(&HSTRING::from(uri)) else {
                return;
            };
            let Ok(reference) = RandomAccessStreamReference::CreateFromUri(&uri) else {
                return;
            };
            let _ = updater.SetThumbnail(&reference);
        }
        Some(ThumbnailSource::ManagedFile(path)) => {
            let Some(path) = path.to_str() else {
                return;
            };
            let Ok(operation) = StorageFile::GetFileFromPathAsync(&HSTRING::from(path)) else {
                return;
            };
            let updater = updater.clone();
            tauri::async_runtime::spawn(async move {
                let Ok(file) = operation.await else {
                    return;
                };
                let Ok(reference) = RandomAccessStreamReference::CreateFromFile(&file) else {
                    return;
                };
                if is_current_thumbnail_request(request_id) {
                    let _ = updater.SetThumbnail(&reference);
                }
            });
        }
        None => {}
    }
}

#[derive(Debug, Eq, PartialEq)]
enum ThumbnailSource {
    Remote(String),
    ManagedFile(PathBuf),
}

fn parse_thumbnail_source(artwork_url: &str) -> Option<ThumbnailSource> {
    parse_thumbnail_source_with_root(artwork_url, &crate::native_desktop_artwork_cache_root())
}

fn parse_thumbnail_source_with_root(
    artwork_url: &str,
    cache_root: &std::path::Path,
) -> Option<ThumbnailSource> {
    let parsed = tauri::Url::parse(artwork_url).ok()?;
    match parsed.scheme() {
        "http" | "https" => Some(ThumbnailSource::Remote(parsed.to_string())),
        "file" => {
            let path = parsed.to_file_path().ok()?;
            let cache_root = cache_root.canonicalize().ok()?;
            let canonical_path = path.canonicalize().ok()?;
            crate::is_artwork_path_in_cache(&cache_root, &canonical_path)
                .then_some(ThumbnailSource::ManagedFile(canonical_path))
        }
        _ => None,
    }
}

fn next_thumbnail_request_id() -> u64 {
    THUMBNAIL_REQUEST.fetch_add(1, Ordering::Relaxed) + 1
}

fn is_current_thumbnail_request(request_id: u64) -> bool {
    THUMBNAIL_REQUEST.load(Ordering::Relaxed) == request_id
}

fn update_timeline(smtc: &SystemMediaTransportControls, position: f64, duration: f64) {
    let Ok(timeline) = SystemMediaTransportControlsTimelineProperties::new() else {
        return;
    };
    let duration_value = seconds_to_timespan(duration);
    let position_value = seconds_to_timespan(position.clamp(0.0, duration.max(0.0)));

    let _ = timeline.SetStartTime(seconds_to_timespan(0.0));
    let _ = timeline.SetMinSeekTime(seconds_to_timespan(0.0));
    if duration.is_finite() && duration > 0.0 {
        let _ = timeline.SetEndTime(duration_value);
        let _ = timeline.SetMaxSeekTime(duration_value);
    }
    let _ = timeline.SetPosition(position_value);
    let _ = smtc.UpdateTimelineProperties(&timeline);
}

fn update_playback_rate(smtc: &SystemMediaTransportControls, rate: f64) {
    if rate.is_finite() && rate > 0.0 {
        let _ = smtc.SetPlaybackRate(rate);
    }
}

fn seconds_to_timespan(seconds: f64) -> TimeSpan {
    let ticks = if seconds.is_finite() && seconds > 0.0 {
        (seconds * TIMESPAN_TICKS_PER_SECOND as f64).round() as i64
    } else {
        0
    };
    TimeSpan { Duration: ticks }
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::Ordering,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        is_current_thumbnail_request, next_thumbnail_request_id, parse_thumbnail_source_with_root,
        ThumbnailSource, THUMBNAIL_REQUEST,
    };

    fn test_cache_root() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "crate windows artwork test-{}-{nonce}",
            std::process::id()
        ))
    }

    #[test]
    fn thumbnail_sources_accept_web_uris_and_reject_other_schemes() {
        let root = test_cache_root();

        assert_eq!(
            parse_thumbnail_source_with_root("https://example.test/cover.jpg", &root),
            Some(ThumbnailSource::Remote(
                "https://example.test/cover.jpg".into()
            ))
        );
        assert_eq!(
            parse_thumbnail_source_with_root("http://example.test/cover.jpg", &root),
            Some(ThumbnailSource::Remote(
                "http://example.test/cover.jpg".into()
            ))
        );
        assert_eq!(
            parse_thumbnail_source_with_root("data:image/png;base64,Y292ZXI=", &root),
            None
        );
    }

    #[test]
    fn thumbnail_source_decodes_managed_file_urls_and_rejects_unmanaged_files() {
        let root = test_cache_root();
        fs::create_dir_all(&root).unwrap();
        let managed = root.join(format!("{}.jpg", "a".repeat(64)));
        fs::write(&managed, b"cover").unwrap();
        let managed_url = tauri::Url::from_file_path(&managed).unwrap().to_string();

        assert_eq!(
            parse_thumbnail_source_with_root(&managed_url, &root),
            Some(ThumbnailSource::ManagedFile(
                managed.canonicalize().unwrap()
            ))
        );

        fs::remove_file(&managed).unwrap();
        assert_eq!(parse_thumbnail_source_with_root(&managed_url, &root), None);

        let outside =
            std::env::temp_dir().join(format!("crate-outside-artwork-{}.jpg", std::process::id()));
        fs::write(&outside, b"outside").unwrap();
        let outside_url = tauri::Url::from_file_path(&outside).unwrap().to_string();
        assert_eq!(parse_thumbnail_source_with_root(&outside_url, &root), None);

        fs::remove_file(outside).unwrap();
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn thumbnail_request_generation_rejects_stale_file_loads() {
        let request = next_thumbnail_request_id();
        assert!(is_current_thumbnail_request(request));

        let newer_request = next_thumbnail_request_id();

        assert!(!is_current_thumbnail_request(request));
        assert!(is_current_thumbnail_request(newer_request));
        THUMBNAIL_REQUEST.store(0, Ordering::Relaxed);
    }
}
