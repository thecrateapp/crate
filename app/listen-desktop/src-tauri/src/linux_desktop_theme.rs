use std::process::Command;

use zbus::zvariant::{OwnedValue, Value};
use zbus::{block_on, Proxy};

const PORTAL_BUS_NAME: &str = "org.freedesktop.portal.Desktop";
const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
const PORTAL_SETTINGS_INTERFACE: &str = "org.freedesktop.portal.Settings";
const PORTAL_APPEARANCE_NAMESPACE: &str = "org.freedesktop.appearance";

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinuxDesktopThemeSnapshot {
    pub scheme: Option<String>,
    pub accent: Option<String>,
    pub gtk_theme: Option<String>,
    pub icon_theme: Option<String>,
    pub cursor_theme: Option<String>,
    pub font_name: Option<String>,
    pub text_scale: Option<f64>,
    pub source: Vec<String>,
}

pub fn snapshot() -> LinuxDesktopThemeSnapshot {
    let mut snapshot = LinuxDesktopThemeSnapshot::default();

    apply_portal_settings(&mut snapshot);
    apply_gsettings(&mut snapshot);

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

fn apply_portal_settings(snapshot: &mut LinuxDesktopThemeSnapshot) {
    let Ok(portal) = block_on(read_portal_settings()) else {
        return;
    };

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

fn apply_gsettings(snapshot: &mut LinuxDesktopThemeSnapshot) {
    let mut used_gsettings = false;

    if snapshot.scheme.is_none() {
        if let Some(value) = gsettings_value("org.gnome.desktop.interface", "color-scheme") {
            snapshot.scheme = scheme_from_gsettings_color_scheme(&value).map(str::to_string);
            used_gsettings = used_gsettings || snapshot.scheme.is_some();
        }
    }

    if snapshot.accent.is_none() {
        if let Some(value) = gsettings_value("org.gnome.desktop.interface", "accent-color") {
            snapshot.accent = accent_from_gsettings_name(&value).map(str::to_string);
            used_gsettings = used_gsettings || snapshot.accent.is_some();
        }
    }

    if snapshot.gtk_theme.is_none() {
        snapshot.gtk_theme = gsettings_value("org.gnome.desktop.interface", "gtk-theme");
        used_gsettings = used_gsettings || snapshot.gtk_theme.is_some();
    }
    if snapshot.icon_theme.is_none() {
        snapshot.icon_theme = gsettings_value("org.gnome.desktop.interface", "icon-theme");
        used_gsettings = used_gsettings || snapshot.icon_theme.is_some();
    }
    if snapshot.cursor_theme.is_none() {
        snapshot.cursor_theme = gsettings_value("org.gnome.desktop.interface", "cursor-theme");
        used_gsettings = used_gsettings || snapshot.cursor_theme.is_some();
    }
    if snapshot.font_name.is_none() {
        snapshot.font_name = gsettings_value("org.gnome.desktop.interface", "font-name");
        used_gsettings = used_gsettings || snapshot.font_name.is_some();
    }
    if snapshot.text_scale.is_none() {
        snapshot.text_scale = gsettings_value("org.gnome.desktop.interface", "text-scaling-factor")
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| value.is_finite() && *value > 0.0);
        used_gsettings = used_gsettings || snapshot.text_scale.is_some();
    }

    if used_gsettings {
        snapshot.source.push("gsettings".into());
    }
}

fn gsettings_value(schema: &str, key: &str) -> Option<String> {
    let output = Command::new("gsettings")
        .args(["get", schema, key])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let raw = String::from_utf8(output.stdout).ok()?;
    clean_gsettings_value(&raw)
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
        accent_from_gsettings_name, clean_gsettings_value, rgb_to_hex,
        scheme_from_gsettings_color_scheme, scheme_from_theme_name,
    };

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
}
