//! Keep idle actions from firing while music plays.
//!
//! Crate holds a logind `idle` inhibitor in `block` mode only while it plays.
//! logind then skips its own `IdleAction`, and idle daemons that honour logind
//! idle inhibitors hold back their idle-triggered actions: hypridle (Hyprland
//! and niri on Ryoku) does by default (`ignore_systemd_inhibit = false`), and it
//! holds every listener, so dimming, locking and blanking wait as well as an
//! idle suspend. It is deliberately not a `sleep` inhibitor: that would also
//! refuse a suspend the user asks for (the Ryoku power menu,
//! `systemctl suspend`). Manual suspend and closing a laptop lid still suspend.

use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc, Mutex, OnceLock,
};

const WHAT: &str = "idle";
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
                Err(err) => eprintln!("could not take the idle inhibitor: {err}"),
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

    /// `idle`, never `sleep`: a `sleep` block also refuses the suspend a user
    /// asks for from a power menu or `systemctl suspend`.
    #[test]
    fn inhibits_idle_only_so_manual_suspend_still_works() {
        assert_eq!((WHAT, MODE), ("idle", "block"));
        assert!(!WHAT.split(':').any(|what| what == "sleep"));
    }
}
