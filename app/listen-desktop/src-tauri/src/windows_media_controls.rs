use std::sync::OnceLock;

use tauri::Manager;
use windows::core::{Result as WinResult, HSTRING};
use windows::Foundation::{TimeSpan, TypedEventHandler, Uri};
use windows::Media::{
    MediaPlaybackStatus, MediaPlaybackType, SystemMediaTransportControls,
    SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs,
    SystemMediaTransportControlsDisplayUpdater, SystemMediaTransportControlsTimelineProperties,
};
use windows::Storage::Streams::RandomAccessStreamReference;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;

use crate::{DesktopMediaSessionPayload, PlaybackCommand};

// 100-nanosecond ticks per second, the unit windows::Foundation::TimeSpan
// uses for every SMTC timeline property.
const TIMESPAN_TICKS_PER_SECOND: i64 = 10_000_000;

static MEDIA_APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
static SMTC: OnceLock<SystemMediaTransportControls> = OnceLock::new();

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
            set_thumbnail(&updater, artwork);
        }
        let _ = updater.Update();
    }

    let _ = smtc.SetPlaybackStatus(if payload.is_playing {
        MediaPlaybackStatus::Playing
    } else {
        MediaPlaybackStatus::Paused
    });

    update_timeline(smtc, payload);
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

fn set_thumbnail(updater: &SystemMediaTransportControlsDisplayUpdater, artwork_url: &str) {
    let Ok(uri) = Uri::CreateUri(&HSTRING::from(artwork_url)) else {
        return;
    };
    let Ok(reference) = RandomAccessStreamReference::CreateFromUri(&uri) else {
        return;
    };
    let _ = updater.SetThumbnail(&reference);
}

fn update_timeline(smtc: &SystemMediaTransportControls, payload: &DesktopMediaSessionPayload) {
    let Ok(timeline) = SystemMediaTransportControlsTimelineProperties::new() else {
        return;
    };
    let duration = seconds_to_timespan(payload.duration);
    let position = seconds_to_timespan(payload.position.clamp(0.0, payload.duration.max(0.0)));

    let _ = timeline.SetStartTime(seconds_to_timespan(0.0));
    let _ = timeline.SetMinSeekTime(seconds_to_timespan(0.0));
    if payload.duration.is_finite() && payload.duration > 0.0 {
        let _ = timeline.SetEndTime(duration);
        let _ = timeline.SetMaxSeekTime(duration);
    }
    let _ = timeline.SetPosition(position);
    let _ = smtc.UpdateTimelineProperties(&timeline);
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
