//! What kind of Linux desktop Crate runs on, decided once at start-up.
//!
//! A floating desktop (GNOME, KDE, ...) lets the app own its frame and size, so
//! Crate keeps its own titlebar and clamps the window to the work area. A tiling
//! compositor (Hyprland, niri, Sway, i3, river) owns every window's geometry and
//! draws borders and rounding itself: there Crate drops its titlebar, stops
//! resizing or moving its window, and accepts a smaller minimum size so it fits
//! a tile. Ryoku (a Hyprland or niri desktop) is reported too, for integrations
//! that only make sense there.

use std::{path::Path, sync::OnceLock};

use serde::Serialize;

/// The Wayland app_id / X11 class Crate's windows carry: the bundle identifier
/// (GTK takes it from the program name, see `set_program_name`).
pub const LINUX_APP_ID: &str = "app.cratemusic.crate.desktop";

/// The desktop entry id (file name without `.desktop`) that names Crate to
/// notification daemons (`desktop-entry`) and MPRIS (`DesktopEntry`). It equals
/// the app_id because compositors, docks and daemons look a window up as
/// `<app_id>.desktop` first. Tauri's bundler cannot install an entry under that
/// name: `.deb`/`.rpm` ship `Crate.desktop` (named after `productName`, with
/// `StartupWMClass` set to the app_id by `linux/desktop-template.desktop`). So
/// `linux_desktop_integration` writes `<LINUX_DESKTOP_ENTRY>.desktop` to
/// `$XDG_DATA_HOME/applications` at every start, before any window exists.
pub const LINUX_DESKTOP_ENTRY: &str = LINUX_APP_ID;

/// The icon name used for Crate everywhere (its desktop entry, notifications,
/// the audio stream, the launcher). `linux_desktop_integration` installs it in
/// `$XDG_DATA_HOME/icons/hicolor` at every start, for every kind of install;
/// the packages' own icon is named after the binary (`crate-desktop`) and is
/// missing from AppImage and source runs.
pub const LINUX_ICON_NAME: &str = LINUX_APP_ID;

/// Minimum logical size on a tiling compositor: a half-width tile on a 1366 px
/// screen, minus gaps, must still hold the window.
pub const TILING_MIN_WIDTH: f64 = 600.0;
pub const TILING_MIN_HEIGHT: f64 = 480.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Compositor {
    Gnome,
    Kde,
    Hyprland,
    Niri,
    Sway,
    I3,
    River,
    Other,
}

impl Compositor {
    pub fn is_tiling(self) -> bool {
        matches!(
            self,
            Compositor::Hyprland
                | Compositor::Niri
                | Compositor::Sway
                | Compositor::I3
                | Compositor::River
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinuxDesktopProfile {
    pub compositor: Compositor,
    pub tiling: bool,
    pub ryoku: bool,
}

/// Decide the profile from environment lookups and whether Ryoku is installed.
/// Compositor sockets win over `XDG_CURRENT_DESKTOP`, which launchers and
/// terminals sometimes carry over from another session.
pub fn detect(env: impl Fn(&str) -> Option<String>, ryoku_installed: bool) -> LinuxDesktopProfile {
    let set = |key: &str| env(key).is_some_and(|value| !value.trim().is_empty());

    let compositor = if set("HYPRLAND_INSTANCE_SIGNATURE") {
        Compositor::Hyprland
    } else if set("NIRI_SOCKET") {
        Compositor::Niri
    } else if set("SWAYSOCK") {
        Compositor::Sway
    } else if set("I3SOCK") {
        Compositor::I3
    } else {
        from_current_desktop(env("XDG_CURRENT_DESKTOP").as_deref().unwrap_or(""))
    };

    LinuxDesktopProfile {
        compositor,
        tiling: compositor.is_tiling(),
        // Ryoku ships Hyprland or niri; a Ryoku install under GNOME is just GNOME.
        ryoku: ryoku_installed && matches!(compositor, Compositor::Hyprland | Compositor::Niri),
    }
}

fn from_current_desktop(value: &str) -> Compositor {
    // A colon-separated list, most specific first ("ubuntu:GNOME").
    for part in value.split(':') {
        match part.trim().to_ascii_lowercase().as_str() {
            "hyprland" => return Compositor::Hyprland,
            "niri" => return Compositor::Niri,
            "sway" => return Compositor::Sway,
            "i3" => return Compositor::I3,
            "river" => return Compositor::River,
            "gnome" | "gnome-classic" | "gnome-flashback" => return Compositor::Gnome,
            "kde" | "plasma" => return Compositor::Kde,
            _ => {}
        }
    }
    Compositor::Other
}

fn ryoku_installed() -> bool {
    let config_home = std::env::var_os("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| Path::new(&home).join(".config")));
    Path::new("/usr/share/ryoku").is_dir()
        || config_home.is_some_and(|config| config.join("ryoku").is_dir())
}

/// The profile of this session, computed once.
pub fn current() -> LinuxDesktopProfile {
    static PROFILE: OnceLock<LinuxDesktopProfile> = OnceLock::new();
    *PROFILE.get_or_init(|| detect(|key| std::env::var(key).ok(), ryoku_installed()))
}

/// Give GTK the bundle identifier as the program name before it initialises.
/// GTK 3 takes the Wayland app_id (and the X11 WM_CLASS name) from the program
/// name, not from the `GtkApplication` id, so without this the window reports
/// the binary name (`crate-desktop`) and the dock cannot match it to its entry.
pub fn set_program_name() {
    webkit2gtk::glib::set_prgname(Some(LINUX_APP_ID));
    // The human name. Without it GLib answers g_get_application_name() with the
    // program name, so the tray item (libayatana-appindicator's Title) and the
    // audio stream read `app.cratemusic.crate.desktop` in docks and mixers.
    webkit2gtk::glib::set_application_name(LINUX_APP_NAME);
    // Playback runs in WebKit's web process, which names its PulseAudio /
    // PipeWire stream on its own; libpulse merges PULSE_PROP into every client,
    // and the web process inherits it.
    let merged = pulse_props(std::env::var("PULSE_PROP").ok().as_deref());
    std::env::set_var("PULSE_PROP", merged);
}

/// The name a person sees for Crate: tray, mixer, notifications.
pub const LINUX_APP_NAME: &str = "Crate";

/// PULSE_PROP with Crate's stream identity, keeping any properties the user
/// already set (theirs win: they come last).
pub fn pulse_props(existing: Option<&str>) -> String {
    let ours = format!(
        "application.name='{LINUX_APP_NAME}' application.icon_name='{LINUX_ICON_NAME}' media.role='music'"
    );
    match existing.map(str::trim).filter(|s| !s.is_empty()) {
        Some(theirs) => format!("{ours} {theirs}"),
        None => ours,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn pulse_props_name_the_stream_crate_and_keep_user_props() {
        let ours = pulse_props(None);
        assert!(ours.contains("application.name='Crate'"));
        assert!(ours.contains("application.icon_name='app.cratemusic.crate.desktop'"));
        assert!(ours.contains("media.role='music'"));
        assert_eq!(pulse_props(Some("   ")), ours);
        let merged = pulse_props(Some("application.name='Mine'"));
        assert!(merged.starts_with(&ours));
        assert!(merged.ends_with("application.name='Mine'"));
    }

    fn profile(vars: &[(&str, &str)], ryoku: bool) -> LinuxDesktopProfile {
        let map: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        detect(|key| map.get(key).cloned(), ryoku)
    }

    #[test]
    fn detects_compositors_and_tiling() {
        type Case<'a> = (&'a [(&'a str, &'a str)], Compositor, bool);
        let cases: &[Case] = &[
            (
                &[
                    ("HYPRLAND_INSTANCE_SIGNATURE", "abc"),
                    ("XDG_CURRENT_DESKTOP", "Hyprland"),
                ],
                Compositor::Hyprland,
                true,
            ),
            (
                &[("NIRI_SOCKET", "/run/user/1000/niri.sock")],
                Compositor::Niri,
                true,
            ),
            (
                &[("SWAYSOCK", "/run/user/1000/sway.sock")],
                Compositor::Sway,
                true,
            ),
            (&[("I3SOCK", "/run/user/1000/i3/ipc")], Compositor::I3, true),
            (&[("XDG_CURRENT_DESKTOP", "river")], Compositor::River, true),
            (
                &[("XDG_CURRENT_DESKTOP", "ubuntu:GNOME")],
                Compositor::Gnome,
                false,
            ),
            (&[("XDG_CURRENT_DESKTOP", "KDE")], Compositor::Kde, false),
            (
                &[("XDG_CURRENT_DESKTOP", "X-Cinnamon")],
                Compositor::Other,
                false,
            ),
            (&[], Compositor::Other, false),
        ];
        for (vars, compositor, tiling) in cases {
            let p = profile(vars, false);
            assert_eq!(p.compositor, *compositor, "{vars:?}");
            assert_eq!(p.tiling, *tiling, "{vars:?}");
        }
    }

    #[test]
    fn a_compositor_socket_beats_a_stale_current_desktop() {
        let p = profile(
            &[
                ("XDG_CURRENT_DESKTOP", "GNOME"),
                ("HYPRLAND_INSTANCE_SIGNATURE", "abc"),
            ],
            false,
        );
        assert_eq!(p.compositor, Compositor::Hyprland);
        assert!(p.tiling);
    }

    #[test]
    fn empty_socket_variables_are_ignored() {
        let p = profile(
            &[
                ("HYPRLAND_INSTANCE_SIGNATURE", " "),
                ("XDG_CURRENT_DESKTOP", "GNOME"),
            ],
            true,
        );
        assert_eq!(p.compositor, Compositor::Gnome);
        assert!(!p.ryoku);
    }

    #[test]
    fn ryoku_needs_its_compositor() {
        assert!(profile(&[("HYPRLAND_INSTANCE_SIGNATURE", "abc")], true).ryoku);
        assert!(profile(&[("NIRI_SOCKET", "/tmp/niri")], true).ryoku);
        assert!(!profile(&[("HYPRLAND_INSTANCE_SIGNATURE", "abc")], false).ryoku);
        assert!(!profile(&[("SWAYSOCK", "/tmp/sway")], true).ryoku);
    }

    #[test]
    fn serializes_for_the_frontend() {
        let p = profile(&[("HYPRLAND_INSTANCE_SIGNATURE", "abc")], true);
        assert_eq!(
            serde_json::to_value(p).unwrap(),
            serde_json::json!({"compositor": "hyprland", "tiling": true, "ryoku": true})
        );
    }

    #[test]
    fn the_app_id_is_the_bundle_identifier() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], LINUX_APP_ID);
    }

    /// One name for the window, its desktop entry and its icon: a daemon or
    /// dock that resolves any of them finds the same entry.
    #[test]
    fn the_desktop_entry_and_icon_are_named_after_the_app_id() {
        assert_eq!(LINUX_DESKTOP_ENTRY, "app.cratemusic.crate.desktop");
        assert_eq!(LINUX_DESKTOP_ENTRY, LINUX_APP_ID);
        assert_eq!(LINUX_ICON_NAME, LINUX_APP_ID);
    }

    /// The packaged entry is `Crate.desktop` (Tauri's bundler names it after
    /// `productName`); its `StartupWMClass` still claims the window.
    #[test]
    fn the_packaged_entry_claims_the_window_by_wm_class() {
        let template = include_str!("../linux/desktop-template.desktop");
        assert!(
            template
                .lines()
                .any(|line| line == format!("StartupWMClass={LINUX_APP_ID}")),
            "desktop template must set StartupWMClass={LINUX_APP_ID}"
        );
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["productName"], "Crate");
        for format in ["deb", "rpm"] {
            assert_eq!(
                conf["bundle"]["linux"][format]["desktopTemplate"],
                "linux/desktop-template.desktop"
            );
        }
    }
}
