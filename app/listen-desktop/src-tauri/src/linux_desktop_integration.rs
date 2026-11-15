//! Which desktop entry and icon name Crate on Linux, and the user-level entry
//! Crate writes when nothing else does.
//!
//! Packages (.deb, .rpm, the AUR package) install a visible entry for Crate;
//! Tauri's bundler names it `Crate.desktop` with `Icon=crate-desktop`. Where
//! one is installed, Crate uses it (`identity`) for notifications, MPRIS and
//! the audio stream, and writes nothing: a second, hidden entry under the app
//! id would win the window's app_id lookup and split Crate in two in docks
//! (a pinned "Crate" next to a running "Crate"). A hidden entry an earlier
//! version wrote is removed then, with its icons.
//!
//! Where none is installed (AppImage, source runs), Crate writes
//! `$XDG_DATA_HOME/applications/app.cratemusic.crate.desktop.desktop`
//! (`NoDisplay`) and `$XDG_DATA_HOME/icons/hicolor/<n>x<n>/apps/app.cratemusic.crate.desktop.png`
//! at every start, so the app_id still resolves to an entry and an icon.
//!
//! "Crate's entry" is decided by content, not by file name: a visible
//! application entry whose `StartupWMClass` is the app id and whose `Exec`
//! runs `crate-desktop` (or this executable), looked up in the XDG order
//! (`$XDG_DATA_HOME`, then `$XDG_DATA_DIRS`) with the spec's shadowing.

use std::{
    collections::HashSet,
    env, fs, io,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use crate::linux_desktop_profile::{LINUX_APP_ID, LINUX_DESKTOP_ENTRY, LINUX_ICON_NAME};

const APP_NAME: &str = "Crate";
const APP_COMMENT: &str = "Crate desktop music player";
/// The binary every package installs.
const BINARY_NAME: &str = "crate-desktop";
const DEFAULT_DATA_DIRS: &str = "/usr/local/share:/usr/share";
/// Desktop files are small; anything larger is not one worth parsing.
const MAX_ENTRY_BYTES: u64 = 64 * 1024;
/// `applications/` subdirectories are rare and shallow.
const MAX_DEPTH: usize = 3;

const ICONS: &[(u32, &[u8])] = &[
    (16, include_bytes!("../icons/16x16.png")),
    (32, include_bytes!("../icons/32x32.png")),
    (64, include_bytes!("../icons/64x64.png")),
    (128, include_bytes!("../icons/128x128.png")),
    (256, include_bytes!("../icons/256x256.png")),
    (512, include_bytes!("../icons/512x512.png")),
    (1024, include_bytes!("../icons/1024x1024.png")),
];

/// The desktop entry id and icon name Crate goes by in this session.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DesktopIdentity {
    /// Desktop entry id (file name without `.desktop`): the notification
    /// `desktop-entry` hint and MPRIS `DesktopEntry`.
    pub entry: String,
    /// Icon name (or path): notifications, the audio stream, the launcher.
    pub icon: String,
    /// True for an entry a package (or the user) installed; false for the
    /// one Crate writes itself.
    pub installed: bool,
}

impl DesktopIdentity {
    /// The entry and icons Crate writes itself.
    fn own() -> DesktopIdentity {
        DesktopIdentity {
            entry: LINUX_DESKTOP_ENTRY.into(),
            icon: LINUX_ICON_NAME.into(),
            installed: false,
        }
    }
}

/// Crate's identity for this session, decided once (it reads a few hundred
/// small files the first time).
pub fn identity() -> &'static DesktopIdentity {
    static IDENTITY: OnceLock<DesktopIdentity> = OnceLock::new();
    IDENTITY.get_or_init(|| {
        let Some(data_home) = xdg_data_home() else {
            return DesktopIdentity::own();
        };
        find_installed_entry(
            &search_dirs(&data_home),
            &own_entry_path(&data_home),
            &program_names(),
        )
        .unwrap_or_else(DesktopIdentity::own)
    })
}

/// Write Crate's own entry and icons, or, when a package installed an entry
/// for Crate, remove the ones an earlier version wrote.
pub fn ensure_registered() -> io::Result<()> {
    let Some(data_home) = xdg_data_home() else {
        return Ok(());
    };
    if identity().installed {
        return remove_own(&data_home);
    }
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
        &own_entry_path(data_home),
        desktop_file(exec_path).as_bytes(),
    )
}

/// Remove the hidden entry and the icons Crate wrote, and nothing else: the
/// entry only if it is byte for byte what `desktop_file` writes, an icon only
/// if it is one of Crate's own images.
fn remove_own(data_home: &Path) -> io::Result<()> {
    let entry = own_entry_path(data_home);
    if fs::read_to_string(&entry).is_ok_and(|text| is_own_entry(&text)) {
        remove_if_present(&entry)?;
    }
    for (size, bytes) in ICONS {
        let icon = own_icon_path(data_home, *size);
        if fs::read(&icon).is_ok_and(|existing| existing == *bytes) {
            remove_if_present(&icon)?;
        }
    }
    Ok(())
}

fn remove_if_present(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(err) if err.kind() != io::ErrorKind::NotFound => Err(err),
        _ => Ok(()),
    }
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

/// `applications/` dirs in lookup order: the user's, then `$XDG_DATA_DIRS`.
fn search_dirs(data_home: &Path) -> Vec<PathBuf> {
    let data_dirs = env::var("XDG_DATA_DIRS")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_DATA_DIRS.into());
    let mut dirs = vec![data_home.join("applications")];
    for dir in data_dirs.split(':').filter(|dir| dir.starts_with('/')) {
        let applications = Path::new(dir).join("applications");
        if !dirs.contains(&applications) {
            dirs.push(applications);
        }
    }
    dirs
}

/// Program names an entry may run to count as Crate's: the packaged binary,
/// this executable, the AppImage.
fn program_names() -> Vec<String> {
    let mut names = vec![BINARY_NAME.to_string()];
    let paths = [
        env::current_exe().ok(),
        env::var_os("APPIMAGE").map(PathBuf::from),
    ];
    for path in paths.into_iter().flatten() {
        if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
            if !names.iter().any(|known| known == name) {
                names.push(name.to_string());
            }
        }
    }
    names
}

/// The first visible entry for Crate in `dirs`, in lookup order. An id seen
/// in an earlier dir shadows the same id later (a user's `Hidden=true` copy
/// hides the packaged entry), except Crate's own hidden entry at
/// `own_entry`, which never counts and never shadows.
fn find_installed_entry(
    dirs: &[PathBuf],
    own_entry: &Path,
    programs: &[String],
) -> Option<DesktopIdentity> {
    let mut seen = HashSet::new();
    for dir in dirs {
        let mut files = Vec::new();
        collect_desktop_files(dir, dir, 0, &mut files);
        files.sort();
        for (id, path) in files {
            let Some(text) = read_small(&path) else {
                continue;
            };
            if path == own_entry && is_own_entry(&text) {
                continue;
            }
            if !seen.insert(id.clone()) {
                continue;
            }
            let entry = parse_entry(&text);
            if is_crate_entry(&entry, programs) {
                let icon = entry
                    .icon
                    .filter(|icon| !icon.is_empty())
                    .unwrap_or_else(|| id.clone());
                return Some(DesktopIdentity {
                    entry: id,
                    icon,
                    installed: true,
                });
            }
        }
    }
    None
}

/// `(desktop id, path)` for every `.desktop` file under `root`; files in
/// subdirectories get ids joined with `-` (`kde/foo.desktop` is `kde-foo`).
fn collect_desktop_files(root: &Path, dir: &Path, depth: usize, out: &mut Vec<(String, PathBuf)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            if depth < MAX_DEPTH {
                collect_desktop_files(root, &path, depth + 1, out);
            }
            continue;
        }
        let Some(relative) = path.strip_prefix(root).ok().and_then(Path::to_str) else {
            continue;
        };
        if let Some(stem) = relative.strip_suffix(".desktop") {
            out.push((stem.replace('/', "-"), path));
        }
    }
}

fn read_small(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_ENTRY_BYTES {
        return None;
    }
    fs::read_to_string(path).ok()
}

#[derive(Default)]
struct Entry {
    application: bool,
    hidden: bool,
    no_display: bool,
    wm_class: Option<String>,
    exec: Option<String>,
    icon: Option<String>,
}

/// The keys of the `[Desktop Entry]` group that tell whose entry it is.
fn parse_entry(text: &str) -> Entry {
    let mut entry = Entry::default();
    let mut in_main_group = false;
    for line in text.lines().map(str::trim) {
        if line.starts_with('[') {
            in_main_group = line == "[Desktop Entry]";
            continue;
        }
        if !in_main_group || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = value.trim();
        match key.trim() {
            "Type" => entry.application = value == "Application",
            "Hidden" => entry.hidden = value == "true",
            "NoDisplay" => entry.no_display = value == "true",
            "StartupWMClass" => entry.wm_class = Some(value.to_string()),
            "Exec" => entry.exec = Some(value.to_string()),
            "Icon" => entry.icon = Some(value.to_string()),
            _ => {}
        }
    }
    entry
}

/// A visible application entry that claims Crate's window and runs Crate.
fn is_crate_entry(entry: &Entry, programs: &[String]) -> bool {
    entry.application
        && !entry.hidden
        && !entry.no_display
        && entry.wm_class.as_deref() == Some(LINUX_APP_ID)
        && entry
            .exec
            .as_deref()
            .and_then(exec_program)
            .is_some_and(|program| programs.contains(&program))
}

/// The file name of the program an `Exec` value runs (its first argument,
/// unquoted).
fn exec_program(exec: &str) -> Option<String> {
    let exec = exec.trim_start();
    let first = if let Some(quoted) = exec.strip_prefix('"') {
        let mut out = String::new();
        let mut chars = quoted.chars();
        while let Some(c) = chars.next() {
            match c {
                '\\' => out.extend(chars.next()),
                '"' => break,
                c => out.push(c),
            }
        }
        out
    } else {
        exec.split_whitespace().next()?.to_string()
    };
    Path::new(&first)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
}

/// Is this exactly the entry `desktop_file` writes (for whatever `Exec`)?
fn is_own_entry(text: &str) -> bool {
    text.lines()
        .find_map(|line| line.strip_prefix("Exec="))
        .and_then(|exec| exec.strip_suffix(" %u"))
        .is_some_and(|exec| desktop_file(exec) == text)
}

fn own_entry_path(data_home: &Path) -> PathBuf {
    data_home
        .join("applications")
        .join(format!("{LINUX_DESKTOP_ENTRY}.desktop"))
}

fn own_icon_path(data_home: &Path, size: u32) -> PathBuf {
    data_home
        .join("icons")
        .join("hicolor")
        .join(format!("{size}x{size}"))
        .join("apps")
        .join(format!("{LINUX_ICON_NAME}.png"))
}

fn install_icons(data_home: &Path) -> io::Result<()> {
    for (size, bytes) in ICONS {
        write_if_changed(&own_icon_path(data_home, *size), bytes)?;
    }
    Ok(())
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

    /// A scratch tree with a user data dir (`home`) and a system one (`usr`).
    struct Tree {
        root: PathBuf,
    }

    impl Tree {
        fn new(name: &str) -> Tree {
            let root = std::env::temp_dir().join(format!(
                "crate-desktop-integration-{name}-{}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&root);
            Tree { root }
        }
        fn home(&self) -> PathBuf {
            self.root.join("home")
        }
        fn dirs(&self) -> Vec<PathBuf> {
            vec![
                self.home().join("applications"),
                self.root.join("usr/applications"),
            ]
        }
        fn write(&self, relative: &str, text: &str) -> PathBuf {
            let path = self.root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, text).unwrap();
            path
        }
        fn find(&self) -> Option<DesktopIdentity> {
            find_installed_entry(
                &self.dirs(),
                &own_entry_path(&self.home()),
                &[BINARY_NAME.to_string()],
            )
        }
    }

    impl Drop for Tree {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    /// What Tauri's bundler installs from `linux/desktop-template.desktop`.
    fn packaged_entry() -> String {
        include_str!("../linux/desktop-template.desktop")
            .replace("{{name}}", "Crate")
            .replace("{{comment}}", "Crate desktop music player")
            .replace("{{exec}}", "crate-desktop")
            .replace("{{icon}}", "crate-desktop")
            .replace("{{categories}}", "AudioVideo;Audio;Music;")
    }

    #[test]
    fn registers_the_entry_and_icons_under_the_app_id() {
        let tree = Tree::new("register");
        register_in(&tree.home(), "\"/opt/crate/crate-desktop\"").unwrap();

        let entry = fs::read_to_string(
            tree.home()
                .join("applications")
                .join("app.cratemusic.crate.desktop.desktop"),
        )
        .unwrap();
        let lines: Vec<&str> = entry.lines().collect();
        assert!(lines.contains(&"Icon=app.cratemusic.crate.desktop"));
        assert!(lines.contains(&"StartupWMClass=app.cratemusic.crate.desktop"));
        assert!(lines.contains(&"Exec=\"/opt/crate/crate-desktop\" %u"));
        assert!(is_own_entry(&entry));
        for (size, bytes) in ICONS {
            let icon = tree
                .home()
                .join(format!("icons/hicolor/{size}x{size}/apps"))
                .join("app.cratemusic.crate.desktop.png");
            assert_eq!(fs::read(&icon).unwrap(), *bytes, "{}", icon.display());
        }
        // nothing else installed: Crate goes by its own entry
        assert_eq!(tree.find(), None);
    }

    #[test]
    fn the_packaged_entry_is_crates_identity() {
        let tree = Tree::new("packaged");
        tree.write("usr/applications/Crate.desktop", &packaged_entry());
        // Crate's own hidden entry from an earlier start neither counts nor shadows
        register_in(&tree.home(), "\"/usr/bin/crate-desktop\"").unwrap();
        assert_eq!(
            tree.find(),
            Some(DesktopIdentity {
                entry: "Crate".into(),
                icon: "crate-desktop".into(),
                installed: true,
            })
        );
    }

    #[test]
    fn an_installed_entry_under_the_app_id_wins_over_the_own_one() {
        let tree = Tree::new("renamed");
        let renamed =
            packaged_entry().replace("Icon=crate-desktop", "Icon=app.cratemusic.crate.desktop");
        tree.write(
            "usr/applications/app.cratemusic.crate.desktop.desktop",
            &renamed,
        );
        register_in(&tree.home(), "\"/usr/bin/crate-desktop\"").unwrap();
        let found = tree.find().unwrap();
        assert_eq!(found.entry, "app.cratemusic.crate.desktop");
        assert!(found.installed);
    }

    #[test]
    fn only_entries_that_run_crate_and_claim_its_window_count() {
        let tree = Tree::new("others");
        // the right file name, someone else's app
        tree.write(
            "usr/applications/Crate.desktop",
            "[Desktop Entry]\nType=Application\nName=Crate\nExec=crate-box %u\nStartupWMClass=crate-box\n",
        );
        // runs Crate but claims no window: the deep-link handler
        tree.write(
            "home/applications/crate-desktop-handler.desktop",
            "[Desktop Entry]\nType=Application\nName=Crate\nNoDisplay=true\nExec=\"/opt/crate/crate-desktop\" %u\n",
        );
        // claims the window, runs something else
        tree.write(
            "usr/applications/fake.desktop",
            &packaged_entry().replace("Exec=crate-desktop", "Exec=other"),
        );
        // the right keys outside [Desktop Entry]
        tree.write(
            "usr/applications/group.desktop",
            "[Desktop Entry]\nType=Application\nName=X\nExec=x\n\n[Desktop Action Next]\nExec=crate-desktop --crate-command=next\nStartupWMClass=app.cratemusic.crate.desktop\n",
        );
        // hidden from menus (in its main group: the key is per group)
        tree.write(
            "usr/applications/nodisplay.desktop",
            &packaged_entry().replace("Terminal=false\n", "Terminal=false\nNoDisplay=true\n"),
        );
        assert_eq!(tree.find(), None);
    }

    #[test]
    fn a_users_hidden_copy_shadows_the_packaged_entry() {
        let tree = Tree::new("shadow");
        tree.write("usr/applications/Crate.desktop", &packaged_entry());
        tree.write(
            "home/applications/Crate.desktop",
            "[Desktop Entry]\nHidden=true\n",
        );
        assert_eq!(tree.find(), None);
    }

    #[test]
    fn a_users_own_entry_for_crate_counts() {
        let tree = Tree::new("user");
        tree.write(
            "home/applications/Crate.desktop",
            &packaged_entry().replace(
                "Exec=crate-desktop",
                "Exec=/home/u/.local/bin/crate-desktop",
            ),
        );
        assert_eq!(tree.find().unwrap().entry, "Crate");
    }

    #[test]
    fn entries_in_subdirectories_get_dashed_ids() {
        let tree = Tree::new("subdir");
        tree.write("usr/applications/vendor/Crate.desktop", &packaged_entry());
        assert_eq!(tree.find().unwrap().entry, "vendor-Crate");
    }

    #[test]
    fn removes_only_what_crate_wrote() {
        let tree = Tree::new("remove");
        let home = tree.home();
        register_in(&home, "\"/usr/bin/crate-desktop\"").unwrap();
        // a user's own icon at one size is kept
        let kept = own_icon_path(&home, 64);
        fs::write(&kept, b"mine").unwrap();
        remove_own(&home).unwrap();
        assert!(!own_entry_path(&home).exists());
        assert!(!own_icon_path(&home, 256).exists());
        assert_eq!(fs::read(&kept).unwrap(), b"mine");
        // an edited entry at Crate's path is the user's: kept
        let edited = desktop_file("\"/usr/bin/crate-desktop\"").replace("NoDisplay=true\n", "");
        fs::write(own_entry_path(&home), &edited).unwrap();
        remove_own(&home).unwrap();
        assert_eq!(fs::read_to_string(own_entry_path(&home)).unwrap(), edited);
        // nothing to remove is fine
        let empty = Tree::new("remove-empty");
        remove_own(&empty.home()).unwrap();
    }

    #[test]
    fn reads_the_program_of_an_exec_line() {
        assert_eq!(
            exec_program("crate-desktop %u").as_deref(),
            Some("crate-desktop")
        );
        assert_eq!(
            exec_program("\"/home/u/My Apps/crate-desktop\" %u").as_deref(),
            Some("crate-desktop")
        );
        assert_eq!(
            exec_program("/usr/bin/crate-desktop --crate-command=next").as_deref(),
            Some("crate-desktop")
        );
        assert_eq!(exec_program("   ").as_deref(), None);
    }
}
