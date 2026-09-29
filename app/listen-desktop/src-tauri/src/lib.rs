#[cfg(desktop)]
use std::sync::{Arc, Mutex};
#[cfg(all(desktop, not(target_os = "linux")))]
use std::{
    collections::hash_map::DefaultHasher,
    fs::{self, OpenOptions},
    hash::{Hash, Hasher},
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
#[cfg(target_os = "macos")]
use tauri::menu::{Menu, SubmenuBuilder};
#[cfg(desktop)]
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem};
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
#[cfg(desktop)]
use tauri::webview::PageLoadEvent;
#[cfg(all(desktop, not(target_os = "linux")))]
use tauri::LogicalSize;
#[cfg(desktop)]
use tauri::{
    image::Image, Emitter, Manager, Size, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window,
};
#[cfg(all(desktop, target_os = "linux"))]
use tauri::{PhysicalPosition, PhysicalSize};
#[cfg(desktop)]
use tauri_plugin_deep_link::DeepLinkExt;
#[cfg(desktop)]
use tauri_plugin_window_state::StateFlags;

#[cfg(all(desktop, any(target_os = "linux", test)))]
mod desktop_window_bounds;
#[cfg(target_os = "linux")]
mod linux_desktop_integration;
#[cfg(target_os = "linux")]
mod linux_desktop_theme;
#[cfg(target_os = "linux")]
mod linux_media_controls;
#[cfg(target_os = "macos")]
mod macos_delegate;
#[cfg(target_os = "macos")]
mod macos_dock_menu;
#[cfg(target_os = "macos")]
mod macos_media_controls;
mod observability;
#[cfg(desktop)]
mod offline_storage;
#[cfg(target_os = "windows")]
mod windows_media_controls;

#[cfg(desktop)]
const DESKTOP_DEFAULT_WIDTH: f64 = 1280.0;
#[cfg(desktop)]
const DESKTOP_DEFAULT_HEIGHT: f64 = 820.0;
#[cfg(desktop)]
const DESKTOP_MIN_WIDTH: f64 = 1024.0;
#[cfg(desktop)]
const DESKTOP_MIN_HEIGHT: f64 = 700.0;

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[cfg(desktop)]
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct NowPlayingPayload {
    title: Option<String>,
    artist: Option<String>,
    is_playing: bool,
}

#[cfg(desktop)]
#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopMediaSessionPayload {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    artwork: Option<String>,
    is_playing: bool,
    position: f64,
    duration: f64,
}

#[cfg(desktop)]
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BandcampCookiePayload {
    cookie: String,
}

#[cfg(desktop)]
struct DesktopMenuState {
    tray_title: MenuItem<tauri::Wry>,
    tray_artist: MenuItem<tauri::Wry>,
    is_playing: Arc<Mutex<bool>>,
}

#[cfg(desktop)]
#[derive(Default)]
struct DeepLinkBuffer {
    frontend_ready: bool,
    pending_urls: Vec<String>,
}

#[cfg(desktop)]
impl DeepLinkBuffer {
    fn dispatch(&mut self, urls: Vec<String>) -> Option<Vec<String>> {
        if self.frontend_ready {
            return Some(urls);
        }
        self.pending_urls.extend(urls);
        None
    }

    fn mark_ready(&mut self) -> Vec<String> {
        self.frontend_ready = true;
        std::mem::take(&mut self.pending_urls)
    }
}

#[cfg(desktop)]
#[derive(Default)]
struct DeepLinkState(Mutex<DeepLinkBuffer>);

#[cfg(desktop)]
#[derive(Debug, Default, PartialEq, Eq)]
struct ActivationArgs {
    show_window: bool,
    urls: Vec<String>,
    commands: Vec<String>,
}

#[cfg(desktop)]
fn classify_activation_args(args: impl IntoIterator<Item = String>) -> ActivationArgs {
    let mut activation = ActivationArgs::default();

    for arg in args {
        if arg.starts_with("cratemusic://") {
            activation.urls.push(arg);
        } else if let Some(command) = arg.strip_prefix("--crate-command=") {
            if is_supported_activation_command(command) {
                activation.commands.push(command.to_string());
            }
        }
    }

    activation.show_window = !activation.urls.is_empty() || activation.commands.is_empty();
    activation
}

/// Every command a tray/dock menu item, a media key, or a CLI activation
/// arg can trigger. `Play`/`Pause`/`PlayPause`/`Previous`/`Next` are also
/// the only ones forwarded to the frontend, as the string payload of a
/// "crate:tray-command" event — that set must stay in sync with
/// `DesktopTrayCommand` in `app/listen/src/lib/desktop-tray.ts`.
/// `as_str`/`parse` are the single place mapping this enum to the wire
/// string, so menu builders, native media keys (macOS/Linux) and menu
/// event handling can't drift from each other by typo.
#[cfg(desktop)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum PlaybackCommand {
    Play,
    Pause,
    PlayPause,
    Previous,
    Next,
    Show,
    Hide,
    Quit,
}

#[cfg(desktop)]
impl PlaybackCommand {
    fn as_str(self) -> &'static str {
        match self {
            PlaybackCommand::Play => "play",
            PlaybackCommand::Pause => "pause",
            PlaybackCommand::PlayPause => "play_pause",
            PlaybackCommand::Previous => "previous",
            PlaybackCommand::Next => "next",
            PlaybackCommand::Show => "show",
            PlaybackCommand::Hide => "hide",
            PlaybackCommand::Quit => "quit",
        }
    }

    fn parse(value: &str) -> Option<PlaybackCommand> {
        Some(match value {
            "play" => PlaybackCommand::Play,
            "pause" => PlaybackCommand::Pause,
            "play_pause" => PlaybackCommand::PlayPause,
            "previous" => PlaybackCommand::Previous,
            "next" => PlaybackCommand::Next,
            "show" => PlaybackCommand::Show,
            "hide" => PlaybackCommand::Hide,
            "quit" => PlaybackCommand::Quit,
            _ => return None,
        })
    }
}

#[cfg(desktop)]
#[tauri::command]
fn update_now_playing(
    payload: NowPlayingPayload,
    state: tauri::State<'_, DesktopMenuState>,
) -> Result<(), String> {
    let title = payload
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Nothing playing");
    let artist = payload
        .artist
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Crate");
    let prefix = if payload.is_playing {
        "Playing"
    } else {
        "Paused"
    };

    state
        .tray_title
        .set_text(format!("{prefix}: {}", truncate_menu_text(title, 52)))
        .map_err(|err| err.to_string())?;
    state
        .tray_artist
        .set_text(truncate_menu_text(artist, 58))
        .map_err(|err| err.to_string())?;
    if let Ok(mut is_playing) = state.is_playing.lock() {
        *is_playing = payload.is_playing;
    }

    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn update_desktop_media_session(payload: DesktopMediaSessionPayload) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    macos_media_controls::update_now_playing(&payload);
    #[cfg(target_os = "linux")]
    linux_media_controls::update_now_playing(&payload);
    #[cfg(target_os = "windows")]
    windows_media_controls::update_now_playing(&payload);

    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn cache_desktop_media_artwork(
    cache_key: String,
    bytes: Vec<u8>,
    mime_type: Option<String>,
) -> Result<Option<DesktopArtworkCacheResult>, String> {
    #[cfg(target_os = "linux")]
    {
        linux_media_controls::cache_artwork(&cache_key, &bytes, mime_type.as_deref())
            .map(|url| {
                url.map(|url| DesktopArtworkCacheResult {
                    url,
                    evicted_urls: Vec::new(),
                })
            })
            .map_err(|err| err.to_string())
    }

    #[cfg(not(target_os = "linux"))]
    {
        cache_native_desktop_artwork(&cache_key, &bytes, mime_type.as_deref())
            .map_err(|err| err.to_string())
    }
}

#[cfg(desktop)]
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopArtworkCacheResult {
    url: String,
    evicted_urls: Vec<String>,
}

#[cfg(all(desktop, not(target_os = "linux")))]
const MAX_NATIVE_DESKTOP_ARTWORK_BYTES: usize = 8 * 1024 * 1024;
#[cfg(all(desktop, not(target_os = "linux")))]
const MAX_NATIVE_DESKTOP_ARTWORK_CACHE_BYTES: u64 = 128 * 1024 * 1024;
#[cfg(all(desktop, not(target_os = "linux")))]
const MAX_NATIVE_DESKTOP_ARTWORK_CACHE_ENTRIES: usize = 128;
#[cfg(all(desktop, not(target_os = "linux")))]
const MAX_NATIVE_DESKTOP_ARTWORK_TEMP_AGE_SECS: u64 = 60 * 60;

#[cfg(all(desktop, not(target_os = "linux")))]
fn native_desktop_artwork_cache_root() -> PathBuf {
    std::env::temp_dir()
        .join("crate-desktop")
        .join("media-artwork-v1")
}

#[cfg(all(desktop, not(target_os = "linux")))]
pub(crate) fn is_native_desktop_artwork_path(path: &Path) -> bool {
    path.parent() == Some(native_desktop_artwork_cache_root().as_path())
        && fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_file())
}

#[cfg(all(desktop, not(target_os = "linux")))]
fn native_desktop_artwork_extension(mime_type: Option<&str>, source: &str) -> &'static str {
    let mime = mime_type
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .unwrap_or_default()
        .to_ascii_lowercase();
    match mime.as_str() {
        "image/jpeg" | "image/jpg" => return "jpg",
        "image/png" => return "png",
        "image/webp" => return "webp",
        "image/gif" => return "gif",
        _ => {}
    }
    let source_without_query = source.split_once('?').map_or(source, |(path, _)| path);
    let source_without_fragment = source_without_query
        .split_once('#')
        .map_or(source_without_query, |(path, _)| path);
    match Path::new(source_without_fragment)
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "png",
        Some("webp") => "webp",
        Some("gif") => "gif",
        _ => "jpg",
    }
}

#[cfg(all(desktop, not(target_os = "linux")))]
fn native_desktop_artwork_url(path: &Path) -> io::Result<String> {
    tauri::Url::from_file_path(path)
        .map(|url| url.to_string())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "invalid artwork path"))
}

#[cfg(all(desktop, not(target_os = "linux")))]
fn prune_native_desktop_artwork_cache(
    cache_root: &Path,
    preserve: &Path,
    max_entries: usize,
    max_bytes: u64,
) -> io::Result<Vec<PathBuf>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(cache_root)? {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !metadata.file_type().is_file() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') && name.ends_with(".tmp") {
            let expired = metadata
                .modified()
                .ok()
                .and_then(|modified| modified.elapsed().ok())
                .is_some_and(|age| age.as_secs() > MAX_NATIVE_DESKTOP_ARTWORK_TEMP_AGE_SECS);
            if expired {
                let _ = fs::remove_file(path);
            }
            continue;
        }
        entries.push((
            path,
            metadata.modified().unwrap_or(UNIX_EPOCH),
            metadata.len(),
        ));
    }

    let mut retained_entries = entries.len();
    let mut retained_bytes = entries.iter().map(|(_, _, len)| len).sum::<u64>();
    let mut removed = Vec::new();
    entries.sort_by_key(|(_, modified, _)| *modified);
    for (path, _, len) in entries {
        if retained_entries <= max_entries && retained_bytes <= max_bytes {
            break;
        }
        if path == preserve {
            continue;
        }
        match fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        retained_entries = retained_entries.saturating_sub(1);
        retained_bytes = retained_bytes.saturating_sub(len);
        removed.push(path);
    }
    Ok(removed)
}

#[cfg(all(desktop, not(target_os = "linux")))]
fn native_desktop_artwork_cache_result(
    destination: &Path,
    evicted: Vec<PathBuf>,
) -> io::Result<DesktopArtworkCacheResult> {
    Ok(DesktopArtworkCacheResult {
        url: native_desktop_artwork_url(destination)?,
        evicted_urls: evicted
            .iter()
            .filter_map(|path| native_desktop_artwork_url(path).ok())
            .collect(),
    })
}

#[cfg(all(desktop, not(target_os = "linux")))]
fn cache_native_desktop_artwork(
    cache_key: &str,
    bytes: &[u8],
    mime_type: Option<&str>,
) -> io::Result<Option<DesktopArtworkCacheResult>> {
    if bytes.is_empty() || bytes.len() > MAX_NATIVE_DESKTOP_ARTWORK_BYTES {
        return Ok(None);
    }

    let mut hasher = DefaultHasher::new();
    cache_key.hash(&mut hasher);
    bytes.hash(&mut hasher);
    let cache_id = format!("{:016x}", hasher.finish());
    let cache_root = native_desktop_artwork_cache_root();
    fs::create_dir_all(&cache_root)?;
    let destination = cache_root.join(format!(
        "{}.{}",
        cache_id,
        native_desktop_artwork_extension(mime_type, cache_key)
    ));
    if is_native_desktop_artwork_path(&destination) {
        if let Ok(file) = OpenOptions::new().write(true).open(&destination) {
            let _ = file.set_modified(SystemTime::now());
        }
        let evicted = prune_native_desktop_artwork_cache(
            &cache_root,
            &destination,
            MAX_NATIVE_DESKTOP_ARTWORK_CACHE_ENTRIES,
            MAX_NATIVE_DESKTOP_ARTWORK_CACHE_BYTES,
        )
        .unwrap_or_default();
        return native_desktop_artwork_cache_result(&destination, evicted).map(Some);
    }

    if fs::symlink_metadata(&destination).is_ok() {
        fs::remove_file(&destination)?;
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = cache_root.join(format!(".{cache_id}-{}-{nonce}.tmp", std::process::id()));
    let write_result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, &destination)
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result?;
    let evicted = prune_native_desktop_artwork_cache(
        &cache_root,
        &destination,
        MAX_NATIVE_DESKTOP_ARTWORK_CACHE_ENTRIES,
        MAX_NATIVE_DESKTOP_ARTWORK_CACHE_BYTES,
    )
    .unwrap_or_default();
    native_desktop_artwork_cache_result(&destination, evicted).map(Some)
}

#[cfg(desktop)]
#[tauri::command]
fn ensure_desktop_window_size(window: tauri::Window) -> Result<(), String> {
    enforce_desktop_window_size(&window);
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn open_bandcamp_cookie_interceptor(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("bandcamp-connect") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    let app_for_load = app.clone();
    let login_url = "https://bandcamp.com/login"
        .parse()
        .map_err(|err| format!("invalid Bandcamp login URL: {err}"))?;
    let window =
        WebviewWindowBuilder::new(&app, "bandcamp-connect", WebviewUrl::External(login_url))
            .title("Connect Bandcamp")
            .inner_size(980.0, 760.0)
            .min_inner_size(720.0, 560.0)
            .on_page_load(move |window, payload| {
                if !matches!(payload.event(), PageLoadEvent::Finished) {
                    return;
                }
                if !is_bandcamp_capture_url(payload.url().as_str()) {
                    return;
                }
                let Some(cookie) = bandcamp_cookie_header_from_window(&window) else {
                    return;
                };

                if let Some(main) = app_for_load.get_webview_window("main") {
                    let _ = main.emit("crate:bandcamp-cookie", BandcampCookiePayload { cookie });
                    let _ = main.show();
                    let _ = main.set_focus();
                }
                let _ = window.close();
            })
            .build()
            .map_err(|err| err.to_string())?;

    set_desktop_window_icon(&window);
    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
async fn linux_desktop_theme_snapshot() -> Result<Option<serde_json::Value>, String> {
    #[cfg(target_os = "linux")]
    {
        serde_json::to_value(linux_desktop_theme::snapshot().await)
            .map(Some)
            .map_err(|err| err.to_string())
    }

    #[cfg(not(target_os = "linux"))]
    {
        Ok(None)
    }
}

#[cfg(desktop)]
#[tauri::command]
fn register_deep_link_listener(
    state: tauri::State<'_, DeepLinkState>,
) -> Result<Vec<String>, String> {
    state
        .0
        .lock()
        .map(|mut buffer| buffer.mark_ready())
        .map_err(|_| "deep-link buffer is unavailable".to_string())
}

#[cfg(desktop)]
fn is_bandcamp_capture_url(value: &str) -> bool {
    let Ok(url) = tauri::Url::parse(value) else {
        return false;
    };
    let host = url.host_str().unwrap_or_default();
    host == "bandcamp.com" || host.ends_with(".bandcamp.com")
}

#[cfg(desktop)]
fn bandcamp_cookie_header_from_window<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
) -> Option<String> {
    let url = tauri::Url::parse("https://bandcamp.com/").ok()?;
    let cookies = window.cookies_for_url(url).ok()?;
    let mut parts = Vec::new();
    let mut has_identity = false;

    for cookie in cookies {
        let name = cookie.name().trim();
        let value = cookie.value().trim();
        if name.is_empty() || value.is_empty() {
            continue;
        }
        if name == "identity" {
            has_identity = true;
        }
        parts.push(format!("{name}={value}"));
    }

    if has_identity && !parts.is_empty() {
        Some(parts.join("; "))
    } else {
        None
    }
}

#[cfg(desktop)]
fn truncate_menu_text(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

#[cfg(desktop)]
fn dispatch_deep_link_urls<R: tauri::Runtime>(window: &WebviewWindow<R>, urls: Vec<String>) {
    let state = window.state::<DeepLinkState>();
    match state.0.lock() {
        Ok(mut buffer) => {
            if let Some(urls) = buffer.dispatch(urls) {
                let _ = window.emit("crate:deep-link", urls);
            }
        }
        Err(_) => {
            let _ = window.emit("crate:deep-link", urls);
        }
    };
}

#[cfg(desktop)]
fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        enforce_desktop_webview_window_size(&window);
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
fn hide_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[cfg(desktop)]
fn enforce_desktop_webview_window_size<R: tauri::Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "linux")]
    {
        enforce_linux_desktop_window_bounds(&window.as_ref().window());
    }

    #[cfg(not(target_os = "linux"))]
    {
        let min_size = LogicalSize::new(DESKTOP_MIN_WIDTH, DESKTOP_MIN_HEIGHT);
        let _ = window.set_min_size(Some(Size::Logical(min_size)));

        if !should_restore_desktop_webview_window_size(window) {
            return;
        }

        let _ = window.set_size(Size::Logical(LogicalSize::new(
            DESKTOP_DEFAULT_WIDTH,
            DESKTOP_DEFAULT_HEIGHT,
        )));
        let _ = window.center();
    }
}

#[cfg(desktop)]
fn enforce_desktop_window_size<R: tauri::Runtime>(window: &Window<R>) {
    #[cfg(target_os = "linux")]
    {
        enforce_linux_desktop_window_bounds(window);
    }

    #[cfg(not(target_os = "linux"))]
    {
        let min_size = LogicalSize::new(DESKTOP_MIN_WIDTH, DESKTOP_MIN_HEIGHT);
        let _ = window.set_min_size(Some(Size::Logical(min_size)));

        if !should_restore_desktop_window_size(window) {
            return;
        }

        let _ = window.set_size(Size::Logical(LogicalSize::new(
            DESKTOP_DEFAULT_WIDTH,
            DESKTOP_DEFAULT_HEIGHT,
        )));
        let _ = window.center();
    }
}

#[cfg(all(desktop, target_os = "linux"))]
fn enforce_linux_desktop_window_bounds<R: tauri::Runtime>(window: &Window<R>) {
    use desktop_window_bounds::{
        clamp_to_work_area, physical_minimum, select_work_area, WindowBounds, WorkArea,
    };

    let (Ok(inner_size), Ok(outer_size), Ok(outer_position), Ok(monitors)) = (
        window.inner_size(),
        window.outer_size(),
        window.outer_position(),
        window.available_monitors(),
    ) else {
        return;
    };
    if monitors.is_empty() {
        return;
    }

    let current_bounds = WindowBounds {
        x: outer_position.x,
        y: outer_position.y,
        width: outer_size.width,
        height: outer_size.height,
    };
    let work_areas = monitors
        .iter()
        .map(|monitor| {
            let work_area = monitor.work_area();
            WorkArea {
                bounds: WindowBounds {
                    x: work_area.position.x,
                    y: work_area.position.y,
                    width: work_area.size.width,
                    height: work_area.size.height,
                },
                scale_factor: monitor.scale_factor(),
            }
        })
        .collect::<Vec<_>>();
    let Some(work_area) = select_work_area(current_bounds, &work_areas) else {
        return;
    };

    let horizontal_insets = outer_size.width.saturating_sub(inner_size.width);
    let vertical_insets = outer_size.height.saturating_sub(inner_size.height);
    let max_inner_width = work_area
        .bounds
        .width
        .saturating_sub(horizontal_insets)
        .max(1);
    let max_inner_height = work_area
        .bounds
        .height
        .saturating_sub(vertical_insets)
        .max(1);
    let min_inner_width =
        physical_minimum(DESKTOP_MIN_WIDTH, work_area.scale_factor, max_inner_width);
    let min_inner_height =
        physical_minimum(DESKTOP_MIN_HEIGHT, work_area.scale_factor, max_inner_height);
    let _ = window.set_min_size(Some(Size::Physical(PhysicalSize::new(
        min_inner_width,
        min_inner_height,
    ))));

    if window.is_maximized().unwrap_or_default() {
        return;
    }

    let enough_room_for_configured_minimum = max_inner_width
        >= (DESKTOP_MIN_WIDTH * work_area.scale_factor).ceil() as u32
        && max_inner_height >= (DESKTOP_MIN_HEIGHT * work_area.scale_factor).ceil() as u32;
    let restore_default_size = enough_room_for_configured_minimum
        && (inner_size.width < min_inner_width || inner_size.height < min_inner_height);
    let default_width =
        ((DESKTOP_DEFAULT_WIDTH * work_area.scale_factor).ceil() as u32).min(max_inner_width);
    let default_height =
        ((DESKTOP_DEFAULT_HEIGHT * work_area.scale_factor).ceil() as u32).min(max_inner_height);
    let desired_inner_width = if restore_default_size {
        default_width
    } else {
        inner_size.width.min(max_inner_width)
    };
    let desired_inner_height = if restore_default_size {
        default_height
    } else {
        inner_size.height.min(max_inner_height)
    };
    let desired_outer_bounds = WindowBounds {
        x: outer_position.x,
        y: outer_position.y,
        width: desired_inner_width.saturating_add(horizontal_insets),
        height: desired_inner_height.saturating_add(vertical_insets),
    };
    let corrected_bounds = clamp_to_work_area(desired_outer_bounds, work_area.bounds);
    let corrected_inner_size = PhysicalSize::new(
        corrected_bounds
            .width
            .saturating_sub(horizontal_insets)
            .max(1),
        corrected_bounds
            .height
            .saturating_sub(vertical_insets)
            .max(1),
    );

    if corrected_inner_size != inner_size {
        let _ = window.set_size(Size::Physical(corrected_inner_size));
    }
    if corrected_bounds.x != outer_position.x || corrected_bounds.y != outer_position.y {
        let _ = window.set_position(PhysicalPosition::new(
            corrected_bounds.x,
            corrected_bounds.y,
        ));
    }
}

#[cfg(desktop)]
#[cfg(not(target_os = "linux"))]
fn should_restore_desktop_webview_window_size<R: tauri::Runtime>(
    window: &WebviewWindow<R>,
) -> bool {
    let Ok(size) = window.inner_size() else {
        return true;
    };
    let scale_factor = window.scale_factor().unwrap_or(1.0).max(1.0);
    let width = f64::from(size.width) / scale_factor;
    let height = f64::from(size.height) / scale_factor;
    width < DESKTOP_MIN_WIDTH || height < DESKTOP_MIN_HEIGHT
}

#[cfg(desktop)]
#[cfg(not(target_os = "linux"))]
fn should_restore_desktop_window_size<R: tauri::Runtime>(window: &Window<R>) -> bool {
    let Ok(size) = window.inner_size() else {
        return true;
    };
    let scale_factor = window.scale_factor().unwrap_or(1.0).max(1.0);
    let width = f64::from(size.width) / scale_factor;
    let height = f64::from(size.height) / scale_factor;
    width < DESKTOP_MIN_WIDTH || height < DESKTOP_MIN_HEIGHT
}

#[cfg(desktop)]
fn emit_playback_command<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    command: PlaybackCommand,
    focus_window: bool,
) {
    if focus_window {
        show_main_window(app);
    }
    let _ = app.emit("crate:tray-command", command.as_str());
}

#[cfg(desktop)]
fn emit_tray_command<R: tauri::Runtime>(app: &tauri::AppHandle<R>, command: PlaybackCommand) {
    emit_playback_command(app, command, false);
}

#[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
pub(crate) fn emit_system_media_command(app: &tauri::AppHandle, command: PlaybackCommand) {
    emit_playback_command(app, command, false);
}

#[cfg(desktop)]
fn current_play_pause_command<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> PlaybackCommand {
    let Some(state) = app.try_state::<DesktopMenuState>() else {
        return PlaybackCommand::PlayPause;
    };

    let command = match state.is_playing.lock() {
        Ok(is_playing) => play_pause_command_for_state(*is_playing),
        Err(_) => PlaybackCommand::PlayPause,
    };
    command
}

#[cfg(desktop)]
fn play_pause_command_for_state(is_playing: bool) -> PlaybackCommand {
    if is_playing {
        PlaybackCommand::Pause
    } else {
        PlaybackCommand::Play
    }
}

#[cfg(desktop)]
fn handle_playback_menu_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, id: &str) {
    let Some(command) = PlaybackCommand::parse(id) else {
        return;
    };
    // No wildcard arm: adding a PlaybackCommand variant without handling
    // it here is a compile error, not a silent no-op.
    match command {
        PlaybackCommand::Play => emit_tray_command(app, PlaybackCommand::Play),
        PlaybackCommand::Pause => emit_tray_command(app, PlaybackCommand::Pause),
        PlaybackCommand::PlayPause => emit_tray_command(app, current_play_pause_command(app)),
        PlaybackCommand::Previous => emit_tray_command(app, PlaybackCommand::Previous),
        PlaybackCommand::Next => emit_tray_command(app, PlaybackCommand::Next),
        PlaybackCommand::Show => show_main_window(app),
        PlaybackCommand::Hide => hide_main_window(app),
        PlaybackCommand::Quit => app.exit(0),
    }
}

#[cfg(desktop)]
fn handle_window_lifecycle_event<R: tauri::Runtime>(
    window: &tauri::Window<R>,
    event: &tauri::WindowEvent,
) {
    if window.label() != "main" {
        return;
    }

    match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = window.hide();
        }
        #[cfg(target_os = "linux")]
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
            enforce_linux_desktop_window_bounds(window);
        }
        _ => {}
    }
}

fn handle_run_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: tauri::RunEvent) {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        let _ = event;
    }

    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Reopen {
        has_visible_windows: false,
        ..
    } = event
    {
        show_main_window(app);
    }
}

#[cfg(desktop)]
fn handle_activation_args<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    argv: impl IntoIterator<Item = String>,
) {
    let activation = classify_activation_args(argv);
    if activation.show_window {
        show_main_window(app);
    }

    if !activation.urls.is_empty() {
        if let Some(window) = app.get_webview_window("main") {
            dispatch_deep_link_urls(&window, activation.urls);
        }
    }

    for command in activation.commands {
        handle_playback_menu_event(app, &command);
    }
}

#[cfg(desktop)]
fn register_deep_links(app: &tauri::App) {
    #[cfg(target_os = "linux")]
    if let Err(err) = app.deep_link().register_all() {
        observability::capture_operation_error(&err, "deep_link.register");
        eprintln!("failed to register Crate deep links: {err}");
    }
    #[cfg(not(target_os = "linux"))]
    let _ = app;
}

#[cfg(desktop)]
fn app_icon_image() -> tauri::Result<Image<'static>> {
    Image::from_bytes(include_bytes!("../icons/icon.png"))
}

#[cfg(desktop)]
fn set_desktop_window_icon<R: tauri::Runtime>(window: &WebviewWindow<R>) {
    let icon = match app_icon_image() {
        Ok(icon) => icon,
        Err(err) => {
            observability::capture_operation_error(&err, "window.icon.decode");
            return;
        }
    };
    if let Err(err) = window.set_icon(icon) {
        observability::capture_operation_error(&err, "window.icon.apply");
    }
}

#[cfg(desktop)]
fn is_supported_activation_command(command: &str) -> bool {
    // Deliberately narrower than every PlaybackCommand: Quit is a valid
    // menu/dock/media-key command but must not be reachable from a CLI
    // `--crate-command=` activation arg.
    matches!(
        PlaybackCommand::parse(command),
        Some(
            PlaybackCommand::Play
                | PlaybackCommand::Pause
                | PlaybackCommand::PlayPause
                | PlaybackCommand::Previous
                | PlaybackCommand::Next
                | PlaybackCommand::Show
                | PlaybackCommand::Hide
        )
    )
}

#[cfg(target_os = "macos")]
fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let play_pause =
        MenuItemBuilder::with_id(PlaybackCommand::PlayPause.as_str(), "Play / Pause").build(app)?;
    let previous =
        MenuItemBuilder::with_id(PlaybackCommand::Previous.as_str(), "Previous").build(app)?;
    let next = MenuItemBuilder::with_id(PlaybackCommand::Next.as_str(), "Next").build(app)?;
    let playback = SubmenuBuilder::with_id(app, "playback", "Playback")
        .items(&[&play_pause, &previous, &next])
        .build()?;
    let menu = Menu::default(app)?;
    let position = menu.items()?.len().min(3);
    menu.insert(&playback, position)?;
    Ok(menu)
}

#[cfg(target_os = "macos")]
fn tray_icon_image() -> tauri::Result<Image<'static>> {
    Image::from_bytes(include_bytes!("../icons/tray-template.png"))
}

#[cfg(not(target_os = "macos"))]
fn tray_icon_image() -> tauri::Result<Image<'static>> {
    Image::from_bytes(include_bytes!("../icons/tray-color.png"))
}

#[cfg(desktop)]
fn handle_tray_icon_event<R: tauri::Runtime>(tray: &TrayIcon<R>, event: TrayIconEvent) {
    if cfg!(target_os = "macos") {
        return;
    }

    match event {
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        }
        | TrayIconEvent::DoubleClick {
            button: MouseButton::Left,
            ..
        } => show_main_window(tray.app_handle()),
        _ => {}
    }
}

#[cfg(desktop)]
fn setup_tray(app: &tauri::App) -> tauri::Result<DesktopMenuState> {
    let tray_icon = tray_icon_image()?;
    let now_title = MenuItemBuilder::with_id("now_title", "Nothing playing")
        .enabled(false)
        .build(app)?;
    let now_artist = MenuItemBuilder::with_id("now_artist", "Crate")
        .enabled(false)
        .build(app)?;
    let play_pause =
        MenuItemBuilder::with_id(PlaybackCommand::PlayPause.as_str(), "Play / Pause").build(app)?;
    let previous =
        MenuItemBuilder::with_id(PlaybackCommand::Previous.as_str(), "Previous").build(app)?;
    let next = MenuItemBuilder::with_id(PlaybackCommand::Next.as_str(), "Next").build(app)?;
    let show = MenuItemBuilder::with_id(PlaybackCommand::Show.as_str(), "Show Crate").build(app)?;
    let hide = MenuItemBuilder::with_id(PlaybackCommand::Hide.as_str(), "Hide Crate").build(app)?;
    let quit = MenuItemBuilder::with_id(PlaybackCommand::Quit.as_str(), "Quit Crate").build(app)?;
    let separator = PredefinedMenuItem::separator(app)?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &now_title,
            &now_artist,
            &separator,
            &play_pause,
            &previous,
            &next,
            &separator,
            &show,
            &hide,
            &separator,
            &quit,
        ])
        .build()?;

    let tray = TrayIconBuilder::with_id("crate")
        .icon(tray_icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("Crate")
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| handle_playback_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(handle_tray_icon_event);

    tray.build(app)?;
    Ok(DesktopMenuState {
        tray_title: now_title,
        tray_artist: now_artist,
        is_playing: Arc::new(Mutex::new(false)),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _sentry_guard = observability::init_sentry("listen-tauri-native");

    #[cfg(target_os = "linux")]
    if let Err(err) = linux_desktop_integration::ensure_registered() {
        observability::capture_operation_error(&err, "linux.desktop.register");
        eprintln!("failed to register Crate desktop integration: {err}");
    }

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder
            .manage(DeepLinkState::default())
            .manage(offline_storage::OfflineTransferRegistry::default())
            .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
                handle_activation_args(app, argv);
            }));
    }

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .menu(build_app_menu)
            .on_menu_event(|app, event| handle_playback_menu_event(app, event.id().as_ref()));
    }

    builder
        .on_window_event(handle_window_lifecycle_event)
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .setup(|app| {
            #[cfg(desktop)]
            {
                if let Err(error) = remove_legacy_http_cookie_jar(app) {
                    eprintln!(
                        "failed to remove legacy HTTP cookie jar ({:?})",
                        error.kind()
                    );
                }

                let menu_state = setup_tray(app)?;
                app.manage(menu_state);
                register_deep_links(app);
                #[cfg(target_os = "macos")]
                macos_dock_menu::install(app);
                #[cfg(target_os = "macos")]
                macos_media_controls::install(app);
                #[cfg(target_os = "linux")]
                linux_media_controls::install(app);
                #[cfg(target_os = "windows")]
                windows_media_controls::install(app);

                let handle = app.handle().clone();
                if let Some(window) = handle.get_webview_window("main") {
                    set_desktop_window_icon(&window);
                    enforce_desktop_webview_window_size(&window);
                    #[cfg(target_os = "linux")]
                    if let Err(err) = window.with_webview(|webview| {
                        use webkit2gtk::{HardwareAccelerationPolicy, SettingsExt, WebViewExt};

                        if let Some(settings) = webview.inner().settings() {
                            settings.set_hardware_acceleration_policy(
                                HardwareAccelerationPolicy::Always,
                            );
                        }
                    }) {
                        eprintln!("failed to request WebKitGTK hardware acceleration: {err}");
                    }
                }
                handle_activation_args(&handle, std::env::args());
                app.deep_link().on_open_url(move |event| {
                    let urls = event
                        .urls()
                        .into_iter()
                        .map(|url| url.to_string())
                        .collect::<Vec<_>>();

                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                        dispatch_deep_link_urls(&window, urls);
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            update_now_playing,
            update_desktop_media_session,
            cache_desktop_media_artwork,
            ensure_desktop_window_size,
            open_bandcamp_cookie_interceptor,
            linux_desktop_theme_snapshot,
            register_deep_link_listener,
            offline_storage::register_offline_transfer,
            offline_storage::cancel_offline_transfer,
            offline_storage::unregister_offline_transfer,
            offline_storage::reconcile_offline_media,
            offline_storage::verify_offline_media_assets,
            offline_storage::download_offline_media
        ])
        .build(tauri::generate_context!())
        .expect("error while building Crate desktop")
        .run(handle_run_event);
}

fn remove_legacy_http_cookie_jar(app: &tauri::App) -> std::io::Result<()> {
    let cache_dir = app.path().app_cache_dir().map_err(std::io::Error::other)?;
    remove_legacy_http_cookie_jar_file(&cache_dir.join(".cookies"))
}

fn remove_legacy_http_cookie_jar_file(path: &std::path::Path) -> std::io::Result<()> {
    match std::fs::remove_file(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

#[cfg(all(test, desktop))]
mod tests {
    use super::{
        classify_activation_args, is_bandcamp_capture_url, is_supported_activation_command,
        play_pause_command_for_state, remove_legacy_http_cookie_jar_file, DeepLinkBuffer,
        PlaybackCommand,
    };

    #[cfg(not(target_os = "linux"))]
    use super::{
        cache_native_desktop_artwork, is_native_desktop_artwork_path,
        prune_native_desktop_artwork_cache,
    };

    #[test]
    fn removes_the_legacy_http_cookie_jar_idempotently() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "crate-desktop-cookie-jar-test-{}-{nonce}",
            std::process::id()
        ));

        std::fs::write(&path, "legacy-cookie-data").unwrap();
        remove_legacy_http_cookie_jar_file(&path).unwrap();

        assert!(!path.exists());
        remove_legacy_http_cookie_jar_file(&path).unwrap();
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn native_artwork_cache_prunes_old_entries_within_budgets() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "crate-desktop-artwork-prune-test-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let preserve = root.join("preserve.webp");
        for name in ["a.webp", "b.webp", "c.webp", "preserve.webp"] {
            std::fs::write(root.join(name), b"data").unwrap();
        }

        let removed = prune_native_desktop_artwork_cache(&root, &preserve, 2, 7).unwrap();

        let retained = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_file()))
            .collect::<Vec<_>>();
        let retained_bytes = retained
            .iter()
            .filter_map(|entry| entry.metadata().ok())
            .map(|metadata| metadata.len())
            .sum::<u64>();
        assert!(preserve.is_file());
        assert!(retained.len() <= 2);
        assert!(retained_bytes <= 7);
        assert!(!removed.is_empty());
        assert!(removed.iter().all(|path| !path.exists()));

        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn native_artwork_cache_materializes_bounded_regular_files() {
        let url = cache_native_desktop_artwork(
            "data:image/png;base64,Y292ZXI=",
            b"native-cover",
            Some("image/png"),
        )
        .unwrap()
        .unwrap();
        let path = tauri::Url::parse(&url.url).unwrap().to_file_path().unwrap();

        assert!(is_native_desktop_artwork_path(&path));
        assert_eq!(std::fs::read(path).unwrap(), b"native-cover");
        assert!(
            cache_native_desktop_artwork("oversized", &vec![0; 8 * 1024 * 1024 + 1], None)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn deep_links_are_buffered_until_the_frontend_listener_is_ready() {
        let mut buffer = DeepLinkBuffer::default();

        assert_eq!(
            buffer.dispatch(vec!["cratemusic://oauth/callback?code=one".into()]),
            None
        );
        assert_eq!(
            buffer.mark_ready(),
            vec!["cratemusic://oauth/callback?code=one"]
        );
    }

    #[test]
    fn deep_links_dispatch_immediately_after_the_frontend_handshake() {
        let mut buffer = DeepLinkBuffer::default();
        assert!(buffer.mark_ready().is_empty());

        assert_eq!(
            buffer.dispatch(vec!["cratemusic://oauth/callback?code=two".into()]),
            Some(vec!["cratemusic://oauth/callback?code=two".into()])
        );
    }

    #[test]
    fn activation_commands_include_system_media_controls() {
        for command in [
            "play",
            "pause",
            "play_pause",
            "previous",
            "next",
            "show",
            "hide",
        ] {
            assert!(is_supported_activation_command(command));
        }

        assert!(!is_supported_activation_command("delete_everything"));
    }

    #[test]
    fn quit_is_a_valid_menu_command_but_not_an_activation_arg() {
        assert!(PlaybackCommand::parse("quit").is_some());
        assert!(!is_supported_activation_command("quit"));
    }

    #[test]
    fn normal_or_unknown_activation_args_request_window_focus() {
        for args in [
            vec![],
            vec!["crate-desktop".into()],
            vec!["--unknown".into()],
        ] {
            assert!(classify_activation_args(args).show_window);
        }
    }

    #[test]
    fn deep_link_activation_requests_window_focus_and_preserves_url() {
        let activation = classify_activation_args([
            "crate-desktop".into(),
            "cratemusic://oauth/callback?code=opaque".into(),
        ]);

        assert!(activation.show_window);
        assert_eq!(
            activation.urls,
            vec!["cratemusic://oauth/callback?code=opaque"]
        );
    }

    #[test]
    fn media_command_activation_does_not_request_window_focus() {
        let activation =
            classify_activation_args(["crate-desktop".into(), "--crate-command=next".into()]);

        assert!(!activation.show_window);
        assert_eq!(activation.commands, vec!["next"]);
    }

    #[test]
    fn play_pause_menu_resolves_to_explicit_transport_commands() {
        assert_eq!(play_pause_command_for_state(true), PlaybackCommand::Pause);
        assert_eq!(play_pause_command_for_state(false), PlaybackCommand::Play);
    }

    #[test]
    fn transport_commands_match_the_frontend_contract() {
        // Mirrors DesktopTrayCommand in app/listen/src/lib/desktop-tray.ts —
        // update both together.
        for (command, wire) in [
            (PlaybackCommand::Play, "play"),
            (PlaybackCommand::Pause, "pause"),
            (PlaybackCommand::PlayPause, "play_pause"),
            (PlaybackCommand::Previous, "previous"),
            (PlaybackCommand::Next, "next"),
        ] {
            assert_eq!(command.as_str(), wire);
            assert_eq!(PlaybackCommand::parse(wire), Some(command));
        }
    }

    #[test]
    fn bandcamp_capture_url_is_restricted_to_bandcamp_hosts() {
        assert!(is_bandcamp_capture_url("https://bandcamp.com/login"));
        assert!(is_bandcamp_capture_url("https://foo.bandcamp.com/"));
        assert!(!is_bandcamp_capture_url(
            "https://evil.example.com/bandcamp.com"
        ));
    }
}
