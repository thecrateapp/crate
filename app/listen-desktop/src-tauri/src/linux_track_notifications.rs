//! Desktop notification when the track changes, like other Linux music players.
//!
//! Shown only when a new track starts playing while Crate's window is not
//! focused, so it never repeats what is on screen. It always replaces the
//! previous card (`replaces_id`), is transient (it does not pile up in the
//! notification history), carries the cached cover as `image-path`, and offers
//! "Show Crate" (the default action) and "Next". Sent with zbus on one worker
//! thread, so a missing notification daemon never blocks playback, and cards
//! go out one at a time: each `Notify` replaces the id the previous one
//! returned. With a thread per card, two quick track changes both read the old
//! id and the first card stayed on screen next to the second.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        mpsc, Mutex, OnceLock,
    },
};

use zbus::zvariant::Value;

use crate::DesktopMediaSessionPayload;

const DEST: &str = "org.freedesktop.Notifications";
const PATH: &str = "/org/freedesktop/Notifications";
const EXPIRE_MS: i32 = 5000;

/// The id of the card we last showed, so actions on it can be told apart from
/// other apps' notifications. Only the worker writes it.
static LAST_ID: AtomicU32 = AtomicU32::new(0);
static LAST_MEDIA: Mutex<Option<String>> = Mutex::new(None);
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
static CARDS: OnceLock<Mutex<mpsc::Sender<Card>>> = OnceLock::new();

/// One track-change notification.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Card {
    summary: String,
    body: String,
    image: Option<String>,
}

/// Show the newest queued card, replacing `last_id`; return the id the next
/// card replaces. Cards queued meanwhile are stale (the track changed again),
/// so only the newest goes out. A failed send keeps `last_id`.
fn show_newest(
    first: Card,
    queued: &mpsc::Receiver<Card>,
    last_id: u32,
    send: &mut impl FnMut(&Card, u32) -> Option<u32>,
) -> u32 {
    let mut card = first;
    while let Ok(newer) = queued.try_recv() {
        card = newer;
    }
    send(&card, last_id).unwrap_or(last_id)
}

/// The worker: the only sender of cards and the only writer of `shown`, so
/// each card replaces the one before it.
fn run(
    queue: mpsc::Receiver<Card>,
    shown: &AtomicU32,
    mut send: impl FnMut(&Card, u32) -> Option<u32>,
) {
    let mut last_id = shown.load(Ordering::SeqCst);
    while let Ok(card) = queue.recv() {
        last_id = show_newest(card, &queue, last_id, &mut send);
        shown.store(last_id, Ordering::SeqCst);
    }
}

fn enqueue(card: Card) {
    let sender = CARDS.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Card>();
        let spawned = std::thread::Builder::new()
            .name("crate-notify".into())
            .spawn(move || {
                run(rx, &LAST_ID, |card, replaces| {
                    notify(card, replaces)
                        .map_err(|err| eprintln!("track notification failed: {err}"))
                        .ok()
                })
            });
        if let Err(err) = spawned {
            eprintln!("failed to start the notification worker: {err}");
        }
        Mutex::new(tx)
    });
    let _ = sender.lock().unwrap_or_else(|p| p.into_inner()).send(card);
}

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

/// One media-session update: notify now, and which track id to remember.
///
/// Only an update that carries an id replaces the remembered one. Updates
/// without an id arrive repeatedly during playback; letting them clear the
/// memory made the next update with the id look like a new track and
/// re-announce it. A track that started while the window was focused, or
/// paused, is remembered too: the user saw it begin, so it is not announced
/// later on focus loss or resume.
fn decide(
    remembered: Option<&str>,
    media_id: Option<&str>,
    playing: bool,
    focused: bool,
) -> (bool, Option<String>) {
    match media_id.map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) => (
            should_notify(remembered, Some(id), playing, focused),
            Some(id.to_string()),
        ),
        None => (false, remembered.map(str::to_string)),
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

/// Called for every media-session update; remembers the track (see `decide`).
pub fn track_update(app: &tauri::AppHandle, payload: &DesktopMediaSessionPayload) {
    use tauri::Manager;
    let focused = app
        .get_webview_window("main")
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false);
    let announce = {
        let mut last = LAST_MEDIA.lock().unwrap_or_else(|p| p.into_inner());
        let (announce, next) = decide(
            last.as_deref(),
            payload.media_id.as_deref(),
            payload.is_playing,
            focused,
        );
        *last = next;
        announce
    };
    if !announce {
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
    enqueue(Card {
        summary: title.to_string(),
        body: body(payload.artist.as_deref(), payload.album.as_deref()),
        image: payload
            .artwork
            .as_deref()
            .filter(|url| url.starts_with("file://"))
            .map(str::to_string),
    });
}

/// The card's hints. `desktop-entry` names the entry the daemon groups the card
/// under and takes the app's icon and settings from.
fn hints(image: Option<&str>) -> HashMap<&'static str, Value<'_>> {
    let mut hints: HashMap<&str, Value<'_>> = HashMap::new();
    hints.insert(
        "desktop-entry",
        Value::from(crate::linux_desktop_profile::LINUX_DESKTOP_ENTRY),
    );
    hints.insert("category", Value::from("x-gnome.music"));
    hints.insert("transient", Value::from(true));
    hints.insert("urgency", Value::from(0u8));
    if let Some(image) = image {
        hints.insert("image-path", Value::from(image));
    }
    hints
}

/// Send one card replacing `replaces` (0: none); returns its id.
// TEST_GAP: needs a session bus and a notification daemon. The ordering it
// relies on (one card at a time, each replacing the previous id) is tested
// through `show_newest` and `run` with a fake daemon.
fn notify(card: &Card, replaces: u32) -> zbus::Result<u32> {
    let connection = zbus::blocking::Connection::session()?;
    let hints = hints(card.image.as_deref());
    let actions = vec!["default", "Show Crate", "next", "Next"];
    let reply = connection.call_method(
        Some(DEST),
        PATH,
        Some(DEST),
        "Notify",
        &(
            "Crate",
            replaces,
            crate::linux_desktop_profile::LINUX_ICON_NAME,
            card.summary.as_str(),
            card.body.as_str(),
            actions,
            hints,
            EXPIRE_MS,
        ),
    )?;
    reply.body().deserialize()
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

    /// Feed updates through `decide` and count the notifications.
    fn notifications(updates: &[(Option<&str>, bool, bool)]) -> usize {
        let mut remembered: Option<String> = None;
        let mut count = 0;
        for (media_id, playing, focused) in updates {
            let (notify, next) = decide(remembered.as_deref(), *media_id, *playing, *focused);
            count += usize::from(notify);
            remembered = next;
        }
        count
    }

    #[test]
    fn an_update_without_an_id_does_not_reannounce_the_track() {
        assert_eq!(
            notifications(&[
                (Some("a"), true, false),
                (None, true, false),
                (Some(""), true, false),
                (Some("  "), true, false),
                (Some("a"), true, false),
            ]),
            1
        );
    }

    #[test]
    fn each_new_track_is_announced_once() {
        assert_eq!(
            notifications(&[
                (Some("a"), true, false),
                (Some("a"), true, false),
                (Some("b"), true, false),
                (Some("b"), true, false),
            ]),
            2
        );
    }

    #[test]
    fn pause_and_resume_of_the_same_track_is_not_announced_again() {
        assert_eq!(
            notifications(&[
                (Some("a"), true, false),
                (Some("a"), false, false),
                (None, false, false),
                (Some("a"), true, false),
            ]),
            1
        );
    }

    #[test]
    fn a_track_that_started_while_focused_is_not_announced_after_unfocus() {
        assert_eq!(
            notifications(&[(Some("a"), true, true), (Some("a"), true, false)]),
            0
        );
        // the next track still is
        assert_eq!(
            notifications(&[
                (Some("a"), true, true),
                (Some("a"), true, false),
                (Some("b"), true, false),
            ]),
            1
        );
    }

    fn card(summary: &str) -> Card {
        Card {
            summary: summary.into(),
            body: String::new(),
            image: None,
        }
    }

    /// A fake daemon: records (summary, replaces_id) and hands out ids 7, 8, ...
    fn daemon(calls: &mut Vec<(String, u32)>) -> impl FnMut(&Card, u32) -> Option<u32> + '_ {
        move |card, replaces| {
            calls.push((card.summary.clone(), replaces));
            Some(7 + calls.len() as u32 - 1)
        }
    }

    #[test]
    fn each_card_replaces_the_one_shown_before_it() {
        let (tx, rx) = mpsc::channel();
        let mut calls = Vec::new();
        let mut send = daemon(&mut calls);
        let id = show_newest(card("A"), &rx, 0, &mut send);
        assert_eq!(id, 7);
        tx.send(card("C")).unwrap();
        // B arrived while A was out; C came before B went: only C is shown,
        // and it replaces A's id, not the one A replaced
        let id = show_newest(card("B"), &rx, id, &mut send);
        assert_eq!(id, 8);
        drop(send);
        assert_eq!(calls, [("A".to_string(), 0), ("C".to_string(), 7)]);
    }

    #[test]
    fn a_failed_send_keeps_the_previous_id() {
        let (_tx, rx) = mpsc::channel();
        let mut down = |_: &Card, _: u32| None;
        assert_eq!(show_newest(card("A"), &rx, 5, &mut down), 5);
    }

    /// A burst of track changes, all queued before the worker wakes: one
    /// card, the newest, replacing the last shown id; the worker publishes
    /// its id for the action listener.
    #[test]
    fn the_worker_shows_only_the_newest_of_a_burst() {
        let (tx, rx) = mpsc::channel();
        for summary in ["A", "B", "C"] {
            tx.send(card(summary)).unwrap();
        }
        drop(tx);
        let shown = AtomicU32::new(3);
        let mut calls = Vec::new();
        run(rx, &shown, daemon(&mut calls));
        assert_eq!(calls, [("C".to_string(), 3)]);
        assert_eq!(shown.load(Ordering::SeqCst), 7);
    }

    #[test]
    fn hints_name_crates_desktop_entry_and_carry_the_cover() {
        let hints = hints(Some("/cache/cover.jpg"));
        assert_eq!(
            hints["desktop-entry"],
            Value::from("app.cratemusic.crate.desktop")
        );
        assert_eq!(hints["image-path"], Value::from("/cache/cover.jpg"));
        assert_eq!(hints["transient"], Value::from(true));
        assert!(!super::hints(None).contains_key("image-path"));
    }

    #[test]
    fn body_joins_artist_and_album_and_escapes_markup() {
        assert_eq!(body(Some("Repion"), Some("Pronto")), "Repion · Pronto");
        assert_eq!(body(Some("A & B"), None), "A &amp; B");
        assert_eq!(body(None, Some("<i>x</i>")), "&lt;i&gt;x&lt;/i&gt;");
        assert_eq!(body(Some(" "), None), "");
    }
}
