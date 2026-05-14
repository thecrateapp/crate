use std::{
    env, fs, io,
    path::{Path, PathBuf},
};

const APP_ID: &str = "app.cratemusic.crate.desktop";
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

    install_icons(&data_home)?;
    install_desktop_file(&data_home)?;
    Ok(())
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
            .join(format!("{APP_ID}.png"));
        write_if_changed(&icon_path, bytes)?;
    }
    Ok(())
}

fn install_desktop_file(data_home: &Path) -> io::Result<()> {
    let applications_dir = data_home.join("applications");
    let desktop_path = applications_dir.join(format!("{APP_ID}.desktop"));
    let exec_path = env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .or_else(|| env::current_exe().ok())
        .map(shell_quoted_path)
        .unwrap_or_else(|| APP_NAME.to_string());

    let desktop_file = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name={APP_NAME}\n\
         Comment={APP_COMMENT}\n\
         Exec={exec_path} %u\n\
         Icon={APP_ID}\n\
         Terminal=false\n\
         Categories=Audio;Music;Player;\n\
         MimeType=x-scheme-handler/cratemusic;\n\
         StartupNotify=true\n\
         StartupWMClass={APP_ID}\n\
         NoDisplay=true\n"
    );

    write_if_changed(&desktop_path, desktop_file.as_bytes())
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
