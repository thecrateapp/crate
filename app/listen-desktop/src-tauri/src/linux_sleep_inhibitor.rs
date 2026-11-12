//! Keep the system awake while music plays.
//!
//! Idle daemons (hypridle on Hyprland/Ryoku, GNOME's and KDE's power managers)
//! end an idle period with `systemctl suspend`, which logind refuses while a
//! `sleep` inhibitor in `block` mode is held. Crate holds one only while it
//! plays, so the screen still dims, blanks and locks as configured, but the
//! computer does not suspend in the middle of an album. Closing a laptop lid
//! still suspends: logind ignores inhibitors for the lid by default
//! (`LidSwitchIgnoreInhibited=yes`).

use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Mutex, OnceLock,
};

const WHAT: &str = "sleep";
const WHO: &str = "Crate";
const WHY: &str = "Playing music";
const MODE: &str = "block";

static WANT_INHIBIT: AtomicBool = AtomicBool::new(false);
static WAKE: OnceLock<Mutex<mpsc::Sender<()>>> = OnceLock::new();

#[derive(Debug, PartialEq, Eq)]
enum Step {
    Acquire,
    Release,
    Keep,
}

fn step(want: bool, held: bool) -> Step {
    match (want, held) {
        (true, false) => Step::Acquire,
        (false, true) => Step::Release,
        _ => Step::Keep,
    }
}

/// Report the playback state; the inhibitor follows it on a worker thread, so
/// a slow or missing logind never blocks the caller.
pub fn set_playing(playing: bool) {
    if WANT_INHIBIT.swap(playing, Ordering::SeqCst) == playing {
        return;
    }
    let sender = WAKE.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<()>();
        let _ = std::thread::Builder::new()
            .name("crate-sleep-inhibitor".into())
            .spawn(move || run(rx));
        Mutex::new(tx)
    });
    let _ = sender.lock().unwrap_or_else(|p| p.into_inner()).send(());
}

fn run(wake: mpsc::Receiver<()>) {
    let mut held: Option<zbus::zvariant::OwnedFd> = None;
    while wake.recv().is_ok() {
        // Coalesce bursts (play/pause toggles) into the latest wish.
        while wake.try_recv().is_ok() {}
        match step(WANT_INHIBIT.load(Ordering::SeqCst), held.is_some()) {
            Step::Acquire => match zbus::block_on(acquire()) {
                Ok(fd) => held = Some(fd),
                Err(err) => eprintln!("could not take the sleep inhibitor: {err}"),
            },
            // Closing the descriptor releases the inhibitor.
            Step::Release => held = None,
            Step::Keep => {}
        }
    }
}

async fn acquire() -> zbus::Result<zbus::zvariant::OwnedFd> {
    let connection = zbus::Connection::system().await?;
    let reply = connection
        .call_method(
            Some("org.freedesktop.login1"),
            "/org/freedesktop/login1",
            Some("org.freedesktop.login1.Manager"),
            "Inhibit",
            &(WHAT, WHO, WHY, MODE),
        )
        .await?;
    reply.body().deserialize::<zbus::zvariant::OwnedFd>()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follows_the_playback_state() {
        assert_eq!(step(true, false), Step::Acquire);
        assert_eq!(step(false, true), Step::Release);
        assert_eq!(step(true, true), Step::Keep);
        assert_eq!(step(false, false), Step::Keep);
    }

    #[test]
    fn blocks_sleep_only_not_idle_or_the_lid() {
        assert_eq!((WHAT, MODE), ("sleep", "block"));
    }
}
