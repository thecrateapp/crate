#[cfg(desktop)]
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    thread,
};
#[cfg(desktop)]
use tauri::menu::{
    Menu, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
#[cfg(desktop)]
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
#[cfg(desktop)]
use tauri::{image::Image, Emitter, LogicalSize, Manager, Size, WebviewWindow, Window};
#[cfg(desktop)]
use tauri_plugin_deep_link::DeepLinkExt;
#[cfg(desktop)]
use tauri_plugin_window_state::StateFlags;

#[cfg(target_os = "macos")]
mod macos_dock_menu;
#[cfg(target_os = "macos")]
mod macos_media_controls;

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
struct DesktopMenuState {
    tray_title: MenuItem<tauri::Wry>,
    tray_artist: MenuItem<tauri::Wry>,
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

    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn update_desktop_media_session(payload: DesktopMediaSessionPayload) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    macos_media_controls::update_now_playing(&payload);

    Ok(())
}

#[cfg(desktop)]
#[tauri::command]
fn ensure_desktop_window_size(window: tauri::Window) -> Result<(), String> {
    enforce_desktop_window_size(&window);
    Ok(())
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
    let _ = window.emit("crate:deep-link", urls.clone());

    if let Ok(payload) = serde_json::to_string(&urls) {
        let script = format!(
            "window.__crateHandleTauriDeepLinks && window.__crateHandleTauriDeepLinks({payload});"
        );
        let _ = window.eval(script);
    }
}

#[cfg(desktop)]
fn dispatch_oauth_callback<R: tauri::Runtime>(app: &tauri::AppHandle<R>, callback_url: String) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        dispatch_deep_link_urls(&window, vec![callback_url]);
    }
}

#[cfg(desktop)]
fn start_oauth_loopback<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", 17654)) {
            Ok(listener) => listener,
            Err(err) => {
                eprintln!("failed to bind Crate OAuth loopback listener: {err}");
                return;
            }
        };

        for stream in listener.incoming() {
            match stream {
                Ok(mut stream) => handle_oauth_loopback_request(&app, &mut stream),
                Err(err) => eprintln!("Crate OAuth loopback request failed: {err}"),
            }
        }
    });
}

#[cfg(desktop)]
fn handle_oauth_loopback_request<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    stream: &mut TcpStream,
) {
    let mut buffer = [0_u8; 4096];
    let read = stream.read(&mut buffer).unwrap_or(0);
    let request = String::from_utf8_lossy(&buffer[..read]);
    let request_target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .unwrap_or("/");

    if let Some(query) = request_target.strip_prefix("/oauth/callback?") {
        let callback_url = format!("cratemusic://oauth/callback?{query}");
        dispatch_oauth_callback(app, callback_url);
        let _ = stream.write_all(OAUTH_LOOPBACK_OK_RESPONSE.as_bytes());
        return;
    }

    if request_target == "/oauth/callback" {
        dispatch_oauth_callback(app, "cratemusic://oauth/callback".to_string());
        let _ = stream.write_all(OAUTH_LOOPBACK_OK_RESPONSE.as_bytes());
        return;
    }

    let _ = stream.write_all(OAUTH_LOOPBACK_NOT_FOUND_RESPONSE.as_bytes());
}

#[cfg(desktop)]
const OAUTH_LOOPBACK_OK_RESPONSE: &str = concat!(
    "HTTP/1.1 200 OK\r\n",
    "Content-Type: text/html; charset=utf-8\r\n",
    "Cache-Control: no-store\r\n",
    "Connection: close\r\n",
    "\r\n",
    "<!doctype html><title>Crate Login</title>",
    "<body style=\"font-family:system-ui;background:#07080d;color:#fff;display:grid;place-items:center;height:100vh;margin:0\">",
    "<main><h1>Crate</h1><p>Login complete. You can close this window.</p></main>",
    "</body>",
);

#[cfg(desktop)]
const OAUTH_LOOPBACK_NOT_FOUND_RESPONSE: &str = concat!(
    "HTTP/1.1 404 Not Found\r\n",
    "Content-Type: text/plain; charset=utf-8\r\n",
    "Connection: close\r\n",
    "\r\n",
    "Not found",
);

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

#[cfg(desktop)]
fn enforce_desktop_window_size<R: tauri::Runtime>(window: &Window<R>) {
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

#[cfg(desktop)]
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
    command: &str,
    focus_window: bool,
) {
    if focus_window {
        show_main_window(app);
    }
    let _ = app.emit("crate:tray-command", command);
}

#[cfg(desktop)]
fn emit_tray_command<R: tauri::Runtime>(app: &tauri::AppHandle<R>, command: &str) {
    emit_playback_command(app, command, true);
}

#[cfg(target_os = "macos")]
pub(crate) fn emit_system_media_command(app: &tauri::AppHandle, command: &str) {
    emit_playback_command(app, command, false);
}

#[cfg(desktop)]
fn handle_playback_menu_event<R: tauri::Runtime>(app: &tauri::AppHandle<R>, id: &str) {
    match id {
        "play" => emit_tray_command(app, "play"),
        "pause" => emit_tray_command(app, "pause"),
        "play_pause" => emit_tray_command(app, "play_pause"),
        "previous" => emit_tray_command(app, "previous"),
        "next" => emit_tray_command(app, "next"),
        "show" => show_main_window(app),
        "hide" => hide_main_window(app),
        "quit" => app.exit(0),
        _ => {}
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

    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
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
    let mut urls = Vec::new();
    let mut commands = Vec::new();

    for arg in argv {
        if arg.starts_with("cratemusic://") {
            urls.push(arg);
        } else if let Some(command) = arg.strip_prefix("--crate-command=") {
            if is_supported_activation_command(command) {
                commands.push(command.to_string());
            }
        }
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        if !urls.is_empty() {
            dispatch_deep_link_urls(&window, urls);
        }
    }

    for command in commands {
        handle_playback_menu_event(app, &command);
    }
}

#[cfg(desktop)]
fn is_supported_activation_command(command: &str) -> bool {
    matches!(
        command,
        "play" | "pause" | "play_pause" | "previous" | "next" | "show" | "hide"
    )
}

#[cfg(desktop)]
fn build_app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let play_pause = MenuItemBuilder::with_id("play_pause", "Play / Pause").build(app)?;
    let previous = MenuItemBuilder::with_id("previous", "Previous").build(app)?;
    let next = MenuItemBuilder::with_id("next", "Next").build(app)?;
    let playback = SubmenuBuilder::with_id(app, "playback", "Playback")
        .items(&[&play_pause, &previous, &next])
        .build()?;
    let menu = Menu::default(app)?;
    let position = menu.items()?.len().min(3);
    menu.insert(&playback, position)?;
    Ok(menu)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn tray_icon_image() -> tauri::Result<Image<'static>> {
    Image::from_bytes(include_bytes!("../icons/tray-template.png"))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
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
    let play_pause = MenuItemBuilder::with_id("play_pause", "Play / Pause").build(app)?;
    let previous = MenuItemBuilder::with_id("previous", "Previous").build(app)?;
    let next = MenuItemBuilder::with_id("next", "Next").build(app)?;
    let show = MenuItemBuilder::with_id("show", "Show Crate").build(app)?;
    let hide = MenuItemBuilder::with_id("hide", "Hide Crate").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit Crate").build(app)?;
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
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            handle_activation_args(app, argv);
        }));
    }

    builder
        .menu(|app| build_app_menu(app))
        .on_menu_event(|app, event| handle_playback_menu_event(app, event.id().as_ref()))
        .on_window_event(handle_window_lifecycle_event)
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .setup(|app| {
            #[cfg(desktop)]
            {
                let menu_state = setup_tray(app)?;
                app.manage(menu_state);
                #[cfg(target_os = "macos")]
                macos_dock_menu::install(app);
                #[cfg(target_os = "macos")]
                macos_media_controls::install(app);

                let handle = app.handle().clone();
                if let Some(window) = handle.get_webview_window("main") {
                    enforce_desktop_webview_window_size(&window);
                }
                handle_activation_args(&handle, std::env::args());
                start_oauth_loopback(handle.clone());
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
            ensure_desktop_window_size
        ])
        .build(tauri::generate_context!())
        .expect("error while building Crate desktop")
        .run(handle_run_event);
}

#[cfg(all(test, desktop))]
mod tests {
    use super::is_supported_activation_command;

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
}
