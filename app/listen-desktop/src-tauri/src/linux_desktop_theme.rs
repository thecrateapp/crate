use std::{
    future::Future,
    process::{Child, Command, Output, Stdio},
    time::{Duration, Instant},
};

use zbus::zvariant::{OwnedValue, Value};
use zbus::Proxy;

const PORTAL_BUS_NAME: &str = "org.freedesktop.portal.Desktop";
const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
const PORTAL_SETTINGS_INTERFACE: &str = "org.freedesktop.portal.Settings";
const PORTAL_APPEARANCE_NAMESPACE: &str = "org.freedesktop.appearance";
const PORTAL_TIMEOUT: Duration = Duration::from_millis(400);
const GSETTINGS_TOTAL_TIMEOUT: Duration = Duration::from_millis(1_000);
const GSETTINGS_COMMAND_TIMEOUT: Duration = Duration::from_millis(200);
const COMMAND_POLL_INTERVAL: Duration = Duration::from_millis(10);

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinuxDesktopThemeSnapshot {
    pub scheme: Option<String>,
    pub accent: Option<String>,
    pub gtk_theme: Option<String>,
    pub window_button_layout: Option<String>,
    pub icon_theme: Option<String>,
    pub cursor_theme: Option<String>,
    pub font_name: Option<String>,
    pub text_scale: Option<f64>,
    pub source: Vec<String>,
}

pub async fn snapshot() -> LinuxDesktopThemeSnapshot {
    let mut snapshot = LinuxDesktopThemeSnapshot::default();

    if let Some(Ok(portal)) = with_timeout(read_portal_settings(), PORTAL_TIMEOUT).await {
        apply_portal_settings(&mut snapshot, portal);
    }

    let gsettings_deadline = Instant::now() + GSETTINGS_TOTAL_TIMEOUT;
    let portal_snapshot = snapshot.clone();
    let gsettings = tokio::task::spawn_blocking(move || {
        let mut snapshot = portal_snapshot;
        apply_gsettings(&mut snapshot, gsettings_deadline);
        snapshot
    })
    .await
    .unwrap_or_else(|_| snapshot.clone());
    snapshot = gsettings;

    if snapshot.scheme.is_none() {
        snapshot.scheme = snapshot
            .gtk_theme
            .as_deref()
            .and_then(scheme_from_theme_name)
            .map(str::to_string);
    }

    snapshot.source.sort();
    snapshot.source.dedup();
    snapshot
}

fn apply_portal_settings(snapshot: &mut LinuxDesktopThemeSnapshot, portal: PortalSettings) {
    let mut used_portal = false;
    if snapshot.scheme.is_none() {
        snapshot.scheme = portal.scheme;
        used_portal = snapshot.scheme.is_some();
    }
    if snapshot.accent.is_none() {
        snapshot.accent = portal.accent;
        used_portal = used_portal || snapshot.accent.is_some();
    }

    if used_portal {
        snapshot.source.push("portal".into());
    }
}

async fn read_portal_settings() -> zbus::Result<PortalSettings> {
    let connection = zbus::Connection::session().await?;
    let proxy = Proxy::new(
        &connection,
        PORTAL_BUS_NAME,
        PORTAL_PATH,
        PORTAL_SETTINGS_INTERFACE,
    )
    .await?;

    let scheme = read_portal_owned(&proxy, "color-scheme")
        .await
        .ok()
        .and_then(portal_scheme_from_value);
    let accent = read_portal_owned(&proxy, "accent-color")
        .await
        .ok()
        .and_then(portal_accent_from_value);

    Ok(PortalSettings { scheme, accent })
}

async fn with_timeout<T>(future: impl Future<Output = T>, timeout: Duration) -> Option<T> {
    tokio::time::timeout(timeout, future).await.ok()
}

async fn read_portal_owned(proxy: &Proxy<'_>, key: &str) -> zbus::Result<OwnedValue> {
    proxy
        .call("Read", &(PORTAL_APPEARANCE_NAMESPACE, key))
        .await
}

fn portal_scheme_from_value(value: OwnedValue) -> Option<String> {
    let value = Value::from(value);
    let scheme = value.downcast::<u32>().ok()?;
    match scheme {
        1 => Some("dark".into()),
        2 => Some("light".into()),
        _ => None,
    }
}

fn portal_accent_from_value(value: OwnedValue) -> Option<String> {
    let value = Value::from(value);
    let (red, green, blue) = value.downcast::<(f64, f64, f64)>().ok()?;
    rgb_to_hex(red, green, blue)
}

fn apply_gsettings(snapshot: &mut LinuxDesktopThemeSnapshot, deadline: Instant) {
    let mut used_gsettings = false;

    if snapshot.scheme.is_none() {
        if let Some(value) =
            gsettings_value("org.gnome.desktop.interface", "color-scheme", deadline)
        {
            snapshot.scheme = scheme_from_gsettings_color_scheme(&value).map(str::to_string);
            used_gsettings = used_gsettings || snapshot.scheme.is_some();
        }
    }

    if snapshot.accent.is_none() {
        if let Some(value) =
            gsettings_value("org.gnome.desktop.interface", "accent-color", deadline)
        {
            snapshot.accent = accent_from_gsettings_name(&value).map(str::to_string);
            used_gsettings = used_gsettings || snapshot.accent.is_some();
        }
    }

    if snapshot.gtk_theme.is_none() {
        snapshot.gtk_theme = gsettings_value("org.gnome.desktop.interface", "gtk-theme", deadline);
        used_gsettings = used_gsettings || snapshot.gtk_theme.is_some();
    }
    if snapshot.window_button_layout.is_none() && is_gnome_desktop() {
        snapshot.window_button_layout = gsettings_value(
            "org.gnome.desktop.wm.preferences",
            "button-layout",
            deadline,
        );
        used_gsettings = used_gsettings || snapshot.window_button_layout.is_some();
    }
    if snapshot.icon_theme.is_none() {
        snapshot.icon_theme =
            gsettings_value("org.gnome.desktop.interface", "icon-theme", deadline);
        used_gsettings = used_gsettings || snapshot.icon_theme.is_some();
    }
    if snapshot.cursor_theme.is_none() {
        snapshot.cursor_theme =
            gsettings_value("org.gnome.desktop.interface", "cursor-theme", deadline);
        used_gsettings = used_gsettings || snapshot.cursor_theme.is_some();
    }
    if snapshot.font_name.is_none() {
        snapshot.font_name = gsettings_value("org.gnome.desktop.interface", "font-name", deadline);
        used_gsettings = used_gsettings || snapshot.font_name.is_some();
    }
    if snapshot.text_scale.is_none() {
        snapshot.text_scale = gsettings_value(
            "org.gnome.desktop.interface",
            "text-scaling-factor",
            deadline,
        )
        .and_then(|value| value.parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0);
        used_gsettings = used_gsettings || snapshot.text_scale.is_some();
    }

    if used_gsettings {
        snapshot.source.push("gsettings".into());
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

fn scheme_from_gsettings_color_scheme(value: &str) -> Option<&'static str> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.contains("dark") {
        Some("dark")
    } else if normalized.contains("light") {
        Some("light")
    } else {
        None
    }
}

fn scheme_from_theme_name(value: &str) -> Option<&'static str> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.contains("dark") {
        Some("dark")
    } else {
        None
    }
}

fn accent_from_gsettings_name(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "blue" => Some("#3584e4"),
        "teal" => Some("#2190a4"),
        "green" => Some("#3a944a"),
        "yellow" => Some("#c88800"),
        "orange" => Some("#ed5b00"),
        "red" => Some("#e62d42"),
        "pink" => Some("#d56199"),
        "purple" => Some("#9141ac"),
        "slate" => Some("#6f8396"),
        _ => None,
    }
}

fn rgb_to_hex(red: f64, green: f64, blue: f64) -> Option<String> {
    if !red.is_finite() || !green.is_finite() || !blue.is_finite() {
        return None;
    }

    Some(format!(
        "#{:02x}{:02x}{:02x}",
        channel_to_u8(red),
        channel_to_u8(green),
        channel_to_u8(blue)
    ))
}

fn channel_to_u8(value: f64) -> u8 {
    let normalized = if value > 1.0 { value / 255.0 } else { value };
    (normalized.clamp(0.0, 1.0) * 255.0).round() as u8
}

#[derive(Clone, Debug, Default)]
struct PortalSettings {
    scheme: Option<String>,
    accent: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::{
        accent_from_gsettings_name, clean_gsettings_value, command_output_with_timeout, rgb_to_hex,
        scheme_from_gsettings_color_scheme, scheme_from_theme_name, with_timeout,
    };
    use std::{process::Command, time::Duration, time::Instant};

    #[test]
    fn gsettings_values_are_unquoted() {
        assert_eq!(
            clean_gsettings_value("'Adwaita-dark'\n").as_deref(),
            Some("Adwaita-dark")
        );
        assert_eq!(clean_gsettings_value("@as []"), None);
    }

    #[test]
    fn scheme_detection_matches_portal_terms() {
        assert_eq!(
            scheme_from_gsettings_color_scheme("prefer-dark"),
            Some("dark")
        );
        assert_eq!(
            scheme_from_gsettings_color_scheme("prefer-light"),
            Some("light")
        );
        assert_eq!(scheme_from_theme_name("Adwaita-dark"), Some("dark"));
        assert_eq!(scheme_from_theme_name("Adwaita"), None);
    }

    #[test]
    fn accent_names_and_rgb_are_normalized() {
        assert_eq!(accent_from_gsettings_name("purple"), Some("#9141ac"));
        assert_eq!(rgb_to_hex(0.0, 0.5, 1.0).as_deref(), Some("#0080ff"));
        assert_eq!(rgb_to_hex(0.0, 128.0, 255.0).as_deref(), Some("#0080ff"));
    }

    #[tokio::test]
    async fn stalled_portal_future_is_dropped_at_its_deadline() {
        let started = Instant::now();
        let result = with_timeout(std::future::pending::<()>(), Duration::from_millis(25)).await;

        assert_eq!(result, None);
        assert!(started.elapsed() < Duration::from_millis(500));
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
    fn missing_gsettings_binary_uses_the_optional_theme_fallback() {
        let command = Command::new("crate-gsettings-binary-not-installed");

        assert!(command_output_with_timeout(command, Duration::from_millis(40)).is_none());
    }
}
