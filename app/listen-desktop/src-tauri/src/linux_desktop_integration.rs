//! Registers Crate's desktop entry and icons in the user's data dir at every
//! start, so the window's app_id resolves to an entry and an icon under every
//! kind of install (packages, AppImage, source runs). See `LINUX_DESKTOP_ENTRY`.

use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

use crate::linux_desktop_profile::{LINUX_APP_ID, LINUX_DESKTOP_ENTRY, LINUX_ICON_NAME};

const APP_NAME: &str = "Crate";
const APP_COMMENT: &str = "Crate desktop music player";

const ICONS: &[(u32, &[u8])] = &[
    (16, include_bytes!("../icons/16x16.png")),
    (32, include_bytes!("../icons/32x32.png")),
    (64, include_bytes!("../icons/64x64.png")),
    (128, include_bytes!("../icons/128x128.png")),
    (256, include_bytes!("../icons/256x256.png")),
    (512, include_bytes!("../icons/512x512.png")),
    (1024, include_bytes!("../icons/1024x1024.png")),
];

pub fn ensure_registered() -> io::Result<()> {
    let Some(data_home) = xdg_data_home() else {
        return Ok(());
    };

    let exec_path = env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .or_else(|| env::current_exe().ok())
        .map(shell_quoted_path)
        .unwrap_or_else(|| APP_NAME.to_string());
    register_in(&data_home, &exec_path)
}

fn register_in(data_home: &Path, exec_path: &str) -> io::Result<()> {
    install_icons(data_home)?;
    write_if_changed(
        &desktop_file_path(data_home),
        desktop_file(exec_path).as_bytes(),
    )
}

fn xdg_data_home() -> Option<PathBuf> {
    if let Some(value) = env::var_os("XDG_DATA_HOME").filter(|value| !value.is_empty()) {
        return Some(PathBuf::from(value));
    }

    env::var_os("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .map(|home| home.join(".local/share"))
}

fn install_icons(data_home: &Path) -> io::Result<()> {
    for (size, bytes) in ICONS {
        let icon_path = data_home
            .join("icons")
            .join("hicolor")
            .join(format!("{size}x{size}"))
            .join("apps")
            .join(format!("{LINUX_ICON_NAME}.png"));
        write_if_changed(&icon_path, bytes)?;
    }
    Ok(())
}

fn desktop_file_path(data_home: &Path) -> PathBuf {
    data_home
        .join("applications")
        .join(format!("{LINUX_DESKTOP_ENTRY}.desktop"))
}

fn desktop_file(exec_path: &str) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name={APP_NAME}\n\
         Comment={APP_COMMENT}\n\
         Exec={exec_path} %u\n\
         Icon={LINUX_ICON_NAME}\n\
         Terminal=false\n\
         Categories=Audio;Music;Player;\n\
         MimeType=x-scheme-handler/cratemusic;\n\
         StartupNotify=true\n\
         StartupWMClass={LINUX_APP_ID}\n\
         NoDisplay=true\n"
    )
}

fn shell_quoted_path(path: PathBuf) -> String {
    let raw = path.to_string_lossy();
    format!("\"{}\"", raw.replace('\\', "\\\\").replace('"', "\\\""))
}

fn write_if_changed(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if fs::read(path).is_ok_and(|existing| existing == bytes) {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_the_entry_and_icons_under_the_app_id() {
        let dir = std::env::temp_dir().join(format!(
            "crate-desktop-integration-test-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        register_in(&dir, "\"/opt/crate/crate-desktop\"").unwrap();

        let entry = fs::read_to_string(
            dir.join("applications")
                .join("app.cratemusic.crate.desktop.desktop"),
        )
        .unwrap();
        let lines: Vec<&str> = entry.lines().collect();
        assert!(lines.contains(&"Icon=app.cratemusic.crate.desktop"));
        assert!(lines.contains(&"StartupWMClass=app.cratemusic.crate.desktop"));
        assert!(lines.contains(&"Exec=\"/opt/crate/crate-desktop\" %u"));
        for (size, bytes) in ICONS {
            let icon = dir
                .join(format!("icons/hicolor/{size}x{size}/apps"))
                .join("app.cratemusic.crate.desktop.png");
            assert_eq!(fs::read(&icon).unwrap(), *bytes, "{}", icon.display());
        }
        let _ = fs::remove_dir_all(&dir);
    }
}
