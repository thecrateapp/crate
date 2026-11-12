//! Desktop notification when the track changes, like other Linux music players.
//!
//! Shown only when a new track starts playing while Crate's window is not
//! focused, so it never repeats what is on screen. It always replaces the
//! previous card (`replaces_id`), is transient (it does not pile up in the
//! notification history), carries the cached cover as `image-path`, and offers
//! "Show Crate" (the default action) and "Next". Sent with zbus on worker
//! threads, so a missing notification daemon never blocks playback.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex, OnceLock,
    },
};

use zbus::zvariant::Value;

use crate::DesktopMediaSessionPayload;

const DEST: &str = "org.freedesktop.Notifications";
const PATH: &str = "/org/freedesktop/Notifications";
const EXPIRE_MS: i32 = 5000;

/// The id of the card we last showed, so the next one replaces it and actions
/// on it can be told apart from other apps' notifications.
static LAST_ID: AtomicU32 = AtomicU32::new(0);
static LAST_MEDIA: Mutex<Option<String>> = Mutex::new(None);
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();

/// Should this media-session update produce a notification?
fn should_notify(
    previous: Option<&str>,
    current: Option<&str>,
    playing: bool,
    focused: bool,
) -> bool {
    match current {
        Some(id) if playing && !focused => previous != Some(id),
        _ => false,
    }
}

/// Notification bodies may carry markup (Ryoku and most daemons support it).
fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn body(artist: Option<&str>, album: Option<&str>) -> String {
    [artist, album]
        .into_iter()
        .flatten()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(escape)
        .collect::<Vec<_>>()
        .join(" · ")
}

pub fn install(app: &tauri::AppHandle) {
    let _ = APP.set(app.clone());
    let spawned = std::thread::Builder::new()
        .name("crate-notify-actions".into())
        .spawn(|| {
            if let Err(err) = listen_for_actions() {
                eprintln!("notification actions unavailable: {err}");
            }
        });
    if let Err(err) = spawned {
        eprintln!("failed to start the notification listener: {err}");
    }
}

/// Called for every media-session update; remembers the track either way.
pub fn track_update(app: &tauri::AppHandle, payload: &DesktopMediaSessionPayload) {
    use tauri::Manager;
    let current = payload.media_id.clone().filter(|id| !id.trim().is_empty());
    let previous = {
        let mut last = LAST_MEDIA.lock().unwrap_or_else(|p| p.into_inner());
        std::mem::replace(&mut *last, current.clone())
    };
    let focused = app
        .get_webview_window("main")
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false);
    if !should_notify(
        previous.as_deref(),
        current.as_deref(),
        payload.is_playing,
        focused,
    ) {
        return;
    }
    let Some(title) = payload
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
    else {
        return;
    };
    let summary = title.to_string();
    let text = body(payload.artist.as_deref(), payload.album.as_deref());
    let image = payload
        .artwork
        .as_deref()
        .filter(|url| url.starts_with("file://"))
        .map(str::to_string);
    let _ = std::thread::Builder::new()
        .name("crate-notify".into())
        .spawn(move || {
            if let Err(err) = notify(&summary, &text, image.as_deref()) {
                eprintln!("track notification failed: {err}");
            }
        });
}

fn notify(summary: &str, body: &str, image: Option<&str>) -> zbus::Result<()> {
    let connection = zbus::blocking::Connection::session()?;
    let mut hints: HashMap<&str, Value<'_>> = HashMap::new();
    hints.insert(
        "desktop-entry",
        Value::from(crate::linux_desktop_profile::LINUX_APP_ID),
    );
    hints.insert("category", Value::from("x-gnome.music"));
    hints.insert("transient", Value::from(true));
    hints.insert("urgency", Value::from(0u8));
    if let Some(image) = image {
        hints.insert("image-path", Value::from(image));
    }
    let actions = vec!["default", "Show Crate", "next", "Next"];
    let reply = connection.call_method(
        Some(DEST),
        PATH,
        Some(DEST),
        "Notify",
        &(
            "Crate",
            LAST_ID.load(Ordering::SeqCst),
            crate::linux_desktop_profile::LINUX_APP_ID,
            summary,
            body,
            actions,
            hints,
            EXPIRE_MS,
        ),
    )?;
    let id: u32 = reply.body().deserialize()?;
    LAST_ID.store(id, Ordering::SeqCst);
    Ok(())
}

fn listen_for_actions() -> zbus::Result<()> {
    let connection = zbus::blocking::Connection::session()?;
    let rule = zbus::MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .interface(DEST)?
        .member("ActionInvoked")?
        .path(PATH)?
        .build();
    let messages = zbus::blocking::MessageIterator::for_match_rule(rule, &connection, None)?;
    for message in messages {
        let Ok(message) = message else { continue };
        let Ok((id, action)) = message.body().deserialize::<(u32, String)>() else {
            continue;
        };
        if id == 0 || id != LAST_ID.load(Ordering::SeqCst) {
            continue;
        }
        let Some(app) = APP.get() else { continue };
        match action.as_str() {
            "default" => crate::show_main_window(app),
            "next" => crate::handle_playback_menu_event(app, "next"),
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notifies_only_for_a_new_playing_track_when_unfocused() {
        assert!(should_notify(Some("a"), Some("b"), true, false));
        assert!(should_notify(None, Some("a"), true, false));
        assert!(
            !should_notify(Some("a"), Some("a"), true, false),
            "same track"
        );
        assert!(!should_notify(Some("a"), Some("b"), false, false), "paused");
        assert!(
            !should_notify(Some("a"), Some("b"), true, true),
            "window focused"
        );
        assert!(!should_notify(Some("a"), None, true, false), "no track");
    }

    #[test]
    fn body_joins_artist_and_album_and_escapes_markup() {
        assert_eq!(body(Some("Repion"), Some("Pronto")), "Repion · Pronto");
        assert_eq!(body(Some("A & B"), None), "A &amp; B");
        assert_eq!(body(None, Some("<i>x</i>")), "&lt;i&gt;x&lt;/i&gt;");
        assert_eq!(body(Some(" "), None), "");
    }
}
