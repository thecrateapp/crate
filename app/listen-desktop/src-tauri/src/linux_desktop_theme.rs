use std::{
    process::{Child, Command, Output, Stdio},
    time::{Duration, Instant},
};

const GSETTINGS_COMMAND_TIMEOUT: Duration = Duration::from_millis(200);
const COMMAND_POLL_INTERVAL: Duration = Duration::from_millis(10);

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinuxDesktopThemeSnapshot {
    pub window_button_layout: Option<String>,
}

pub async fn snapshot() -> LinuxDesktopThemeSnapshot {
    tokio::task::spawn_blocking(|| collect_window_preferences(is_gnome_desktop(), gsettings_value))
        .await
        .unwrap_or_default()
}

fn collect_window_preferences(
    gnome_desktop: bool,
    read: impl FnOnce(&str, &str, Instant) -> Option<String>,
) -> LinuxDesktopThemeSnapshot {
    let window_button_layout = if gnome_desktop {
        read(
            "org.gnome.desktop.wm.preferences",
            "button-layout",
            Instant::now() + GSETTINGS_COMMAND_TIMEOUT,
        )
    } else {
        None
    };

    LinuxDesktopThemeSnapshot {
        window_button_layout,
    }
}

fn is_gnome_desktop() -> bool {
    std::env::var("XDG_CURRENT_DESKTOP")
        .map(|desktop| {
            desktop
                .split(':')
                .any(|name| name.eq_ignore_ascii_case("gnome"))
        })
        .unwrap_or(false)
}

fn gsettings_value(schema: &str, key: &str, deadline: Instant) -> Option<String> {
    let timeout = deadline
        .saturating_duration_since(Instant::now())
        .min(GSETTINGS_COMMAND_TIMEOUT);
    if timeout.is_zero() {
        return None;
    }

    let mut command = Command::new("gsettings");
    command.args(["get", schema, key]);
    let output = command_output_with_timeout(command, timeout)?;
    let raw = String::from_utf8(output.stdout).ok()?;
    clean_gsettings_value(&raw)
}

fn command_output_with_timeout(mut command: Command, timeout: Duration) -> Option<Output> {
    command.stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = command.spawn().ok()?;
    let deadline = Instant::now() + timeout;

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                if !status.success() {
                    return None;
                }
                return child.wait_with_output().ok();
            }
            Ok(None) => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    kill_and_reap(&mut child);
                    return None;
                }
                std::thread::sleep(COMMAND_POLL_INTERVAL.min(remaining));
            }
            Err(_) => {
                kill_and_reap(&mut child);
                return None;
            }
        }
    }
}

fn kill_and_reap(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn clean_gsettings_value(raw: &str) -> Option<String> {
    let value = raw.trim();
    if value.is_empty() || value == "''" || value == "@as []" {
        return None;
    }

    let unquoted = value
        .strip_prefix('\'')
        .and_then(|value| value.strip_suffix('\''))
        .or_else(|| {
            value
                .strip_prefix('"')
                .and_then(|value| value.strip_suffix('"'))
        })
        .unwrap_or(value)
        .replace("\\'", "'");

    if unquoted.trim().is_empty() {
        None
    } else {
        Some(unquoted)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        clean_gsettings_value, collect_window_preferences, command_output_with_timeout,
        LinuxDesktopThemeSnapshot,
    };
    use std::{process::Command, time::Duration, time::Instant};

    #[test]
    fn snapshots_only_serialize_the_compatible_window_button_layout_field() {
        for layout in [None, Some("close:minimize,maximize".to_string())] {
            let snapshot = LinuxDesktopThemeSnapshot {
                window_button_layout: layout.clone(),
            };

            assert_eq!(
                serde_json::to_value(snapshot).unwrap(),
                serde_json::json!({ "windowButtonLayout": layout })
            );
        }
    }

    #[test]
    fn gnome_queries_only_window_button_placement_with_a_bounded_deadline() {
        let mut calls = Vec::new();
        let snapshot = collect_window_preferences(true, |schema, key, deadline| {
            calls.push((schema.to_string(), key.to_string()));
            assert!(
                deadline.saturating_duration_since(Instant::now()) <= Duration::from_millis(200)
            );
            Some("close:minimize,maximize".into())
        });

        assert_eq!(
            calls,
            vec![(
                "org.gnome.desktop.wm.preferences".to_string(),
                "button-layout".to_string()
            )]
        );
        assert_eq!(
            snapshot.window_button_layout.as_deref(),
            Some("close:minimize,maximize")
        );
    }

    #[test]
    fn other_desktops_do_not_read_gsettings() {
        let snapshot = collect_window_preferences(false, |_, _, _| {
            panic!("non-GNOME desktops must not run gsettings")
        });

        assert!(snapshot.window_button_layout.is_none());
    }

    #[test]
    fn missing_window_preferences_keep_the_optional_fallback() {
        let snapshot = collect_window_preferences(true, |_, _, _| None);

        assert!(snapshot.window_button_layout.is_none());
    }

    #[test]
    fn gsettings_values_are_cleaned_without_changing_button_placement() {
        for (raw, expected) in [
            (
                "'close:minimize,maximize'\n",
                Some("close:minimize,maximize"),
            ),
            (
                "\":minimize,maximize,close\"",
                Some(":minimize,maximize,close"),
            ),
            ("close,minimize:maximize", Some("close,minimize:maximize")),
            ("", None),
            ("   ", None),
            ("''", None),
            ("@as []", None),
        ] {
            assert_eq!(clean_gsettings_value(raw).as_deref(), expected, "{raw:?}");
        }
    }

    #[test]
    fn stalled_gsettings_process_is_killed_and_reaped() {
        let mut command = Command::new("sleep");
        command.arg("5");
        let started = Instant::now();

        assert!(command_output_with_timeout(command, Duration::from_millis(40)).is_none());
        assert!(started.elapsed() < Duration::from_millis(500));
    }

    #[test]
    fn missing_gsettings_binary_keeps_the_optional_window_fallback() {
        let command = Command::new("crate-gsettings-binary-not-installed");

        assert!(command_output_with_timeout(command, Duration::from_millis(40)).is_none());
    }
}
