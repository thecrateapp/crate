use std::{
    ptr,
    sync::{Mutex, OnceLock},
};

use objc2::{
    class,
    encode::{Encode, Encoding},
    ffi, msg_send,
    runtime::{AnyClass, AnyObject, Imp, Sel},
    sel,
};
use objc2_app_kit::NSApplication;
use objc2_foundation::{MainThreadMarker, NSString};

use crate::DesktopMediaSessionPayload;

#[link(name = "MediaPlayer", kind = "framework")]
unsafe extern "C" {
    static MPMediaItemPropertyTitle: *mut AnyObject;
    static MPMediaItemPropertyArtist: *mut AnyObject;
    static MPMediaItemPropertyAlbumTitle: *mut AnyObject;
    static MPMediaItemPropertyArtwork: *mut AnyObject;
    static MPMediaItemPropertyPlaybackDuration: *mut AnyObject;
    static MPNowPlayingInfoPropertyElapsedPlaybackTime: *mut AnyObject;
    static MPNowPlayingInfoPropertyPlaybackRate: *mut AnyObject;
}

static MEDIA_APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();
static ARTWORK_CACHE: OnceLock<Mutex<ArtworkCache>> = OnceLock::new();

#[derive(Default)]
struct ArtworkCache {
    url: Option<String>,
    artwork: usize,
    retained_image: usize,
}

struct LoadedArtwork {
    artwork: *mut AnyObject,
    retained_image: usize,
}

type MediaActionImp = unsafe extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> isize;

#[cfg(target_pointer_width = "32")]
type CGFloat = f32;
#[cfg(target_pointer_width = "64")]
type CGFloat = f64;

#[repr(C)]
#[derive(Clone, Copy)]
struct CGSize {
    width: CGFloat,
    height: CGFloat,
}

// SAFETY: CGSize is a CoreGraphics-compatible repr(C) pair of CGFloats.
unsafe impl Encode for CGSize {
    const ENCODING: Encoding = Encoding::Struct("CGSize", &[CGFloat::ENCODING, CGFloat::ENCODING]);
}

pub fn install(app: &tauri::App) {
    let _ = MEDIA_APP_HANDLE.set(app.handle().clone());
    let _ = app.handle().run_on_main_thread(|| unsafe {
        patch_application_delegate();
        register_remote_commands();
    });
}

pub fn update_now_playing(payload: &DesktopMediaSessionPayload) {
    let payload = payload.clone();
    if let Some(app) = MEDIA_APP_HANDLE.get() {
        let _ = app.run_on_main_thread(move || unsafe {
            set_now_playing_info(&payload);
        });
    }
}

unsafe fn patch_application_delegate() {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let app = NSApplication::sharedApplication(mtm);
    let Some(delegate) = app.delegate() else {
        return;
    };
    let delegate_ref = &*delegate;
    let delegate_object: &AnyObject = delegate_ref.as_ref();
    let class = delegate_object.class() as *const AnyClass as *mut AnyClass;

    replace_method(
        class,
        sel!(crateMediaPlay:),
        media_action_imp(media_play),
        b"q@:@\0",
    );
    replace_method(
        class,
        sel!(crateMediaPause:),
        media_action_imp(media_pause),
        b"q@:@\0",
    );
    replace_method(
        class,
        sel!(crateMediaTogglePlayPause:),
        media_action_imp(media_toggle_play_pause),
        b"q@:@\0",
    );
    replace_method(
        class,
        sel!(crateMediaPrevious:),
        media_action_imp(media_previous),
        b"q@:@\0",
    );
    replace_method(
        class,
        sel!(crateMediaNext:),
        media_action_imp(media_next),
        b"q@:@\0",
    );
}

unsafe fn register_remote_commands() {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let app = NSApplication::sharedApplication(mtm);
    let Some(delegate) = app.delegate() else {
        return;
    };
    let delegate_ref = &*delegate;
    let delegate_object: &AnyObject = delegate_ref.as_ref();
    let center: *mut AnyObject = msg_send![class!(MPRemoteCommandCenter), sharedCommandCenter];
    if center.is_null() {
        return;
    }

    let play: *mut AnyObject = msg_send![center, playCommand];
    register_remote_command(play, delegate_object, sel!(crateMediaPlay:));

    let pause: *mut AnyObject = msg_send![center, pauseCommand];
    register_remote_command(pause, delegate_object, sel!(crateMediaPause:));

    let toggle: *mut AnyObject = msg_send![center, togglePlayPauseCommand];
    register_remote_command(toggle, delegate_object, sel!(crateMediaTogglePlayPause:));

    let previous: *mut AnyObject = msg_send![center, previousTrackCommand];
    register_remote_command(previous, delegate_object, sel!(crateMediaPrevious:));

    let next: *mut AnyObject = msg_send![center, nextTrackCommand];
    register_remote_command(next, delegate_object, sel!(crateMediaNext:));
}

unsafe fn register_remote_command(command: *mut AnyObject, target: &AnyObject, action: Sel) {
    if command.is_null() {
        return;
    }
    let _: () = msg_send![command, setEnabled: true];
    let _: *mut AnyObject = msg_send![command, addTarget: target, action: action];
}

unsafe fn set_now_playing_info(payload: &DesktopMediaSessionPayload) {
    let center: *mut AnyObject = msg_send![class!(MPNowPlayingInfoCenter), defaultCenter];
    if center.is_null() {
        return;
    }

    let Some(title) = non_empty(payload.title.as_deref()) else {
        let _: () = msg_send![center, setNowPlayingInfo: ptr::null_mut::<AnyObject>()];
        clear_artwork_cache();
        return;
    };

    let info: *mut AnyObject = msg_send![class!(NSMutableDictionary), dictionary];
    if info.is_null() {
        return;
    }

    set_string(info, MPMediaItemPropertyTitle, title);
    if let Some(artist) = non_empty(payload.artist.as_deref()) {
        set_string(info, MPMediaItemPropertyArtist, artist);
    }
    if let Some(album) = non_empty(payload.album.as_deref()) {
        set_string(info, MPMediaItemPropertyAlbumTitle, album);
    }
    if let Some(artwork_url) = non_empty(payload.artwork.as_deref()) {
        if let Some(artwork) = cached_artwork_for_url(artwork_url) {
            set_object(info, MPMediaItemPropertyArtwork, artwork);
        }
    }

    set_number(
        info,
        MPNowPlayingInfoPropertyPlaybackRate,
        if payload.is_playing { 1.0 } else { 0.0 },
    );
    if payload.duration.is_finite() && payload.duration > 0.0 {
        set_number(info, MPMediaItemPropertyPlaybackDuration, payload.duration);
    }
    if payload.position.is_finite() && payload.position >= 0.0 {
        set_number(
            info,
            MPNowPlayingInfoPropertyElapsedPlaybackTime,
            payload.position,
        );
    }

    let _: () = msg_send![center, setNowPlayingInfo: info];
}

unsafe fn cached_artwork_for_url(url: &str) -> Option<*mut AnyObject> {
    if let Ok(cache) = artwork_cache().lock() {
        if cache.url.as_deref() == Some(url) && cache.artwork != 0 {
            return Some(cache.artwork as *mut AnyObject);
        }
    }

    let loaded = load_artwork(url)?;
    if let Ok(mut cache) = artwork_cache().lock() {
        release_cached_artwork(&mut cache);
        cache.url = Some(url.to_string());
        cache.artwork = loaded.artwork as usize;
        cache.retained_image = loaded.retained_image;
    }
    Some(loaded.artwork)
}

unsafe fn load_artwork(url: &str) -> Option<LoadedArtwork> {
    let url_string = NSString::from_str(url);
    let ns_url: *mut AnyObject = msg_send![class!(NSURL), URLWithString: &*url_string];
    if ns_url.is_null() {
        return None;
    }

    let data: *mut AnyObject = msg_send![class!(NSData), dataWithContentsOfURL: ns_url];
    if data.is_null() {
        return None;
    }

    let image_alloc: *mut AnyObject = msg_send![class!(NSImage), alloc];
    if image_alloc.is_null() {
        return None;
    }
    let image: *mut AnyObject = msg_send![image_alloc, initWithData: data];
    if image.is_null() {
        return None;
    }

    if let Some(artwork) = load_modern_artwork(image) {
        return Some(artwork);
    }

    load_legacy_artwork(image)
}

unsafe fn load_modern_artwork(image: *mut AnyObject) -> Option<LoadedArtwork> {
    let supports_modern_init: bool = msg_send![
        class!(MPMediaItemArtwork),
        instancesRespondToSelector: sel!(initWithBoundsSize:requestHandler:)
    ];
    if !supports_modern_init {
        return None;
    }

    let size: CGSize = msg_send![image, size];
    let image_for_block = image;
    let request_handler =
        block2::RcBlock::new(move |_size: CGSize| -> *mut AnyObject { image_for_block });
    let artwork_alloc: *mut AnyObject = msg_send![class!(MPMediaItemArtwork), alloc];
    if artwork_alloc.is_null() {
        let _: () = msg_send![image, release];
        return None;
    }
    let artwork: *mut AnyObject =
        msg_send![artwork_alloc, initWithBoundsSize: size, requestHandler: &*request_handler];

    if artwork.is_null() {
        let _: () = msg_send![image, release];
        None
    } else {
        Some(LoadedArtwork {
            artwork,
            retained_image: image as usize,
        })
    }
}

unsafe fn load_legacy_artwork(image: *mut AnyObject) -> Option<LoadedArtwork> {
    let supports_legacy_image_init: bool =
        msg_send![class!(MPMediaItemArtwork), instancesRespondToSelector: sel!(initWithImage:)];
    if !supports_legacy_image_init {
        let _: () = msg_send![image, release];
        return None;
    }

    let artwork_alloc: *mut AnyObject = msg_send![class!(MPMediaItemArtwork), alloc];
    if artwork_alloc.is_null() {
        let _: () = msg_send![image, release];
        return None;
    }
    let artwork: *mut AnyObject = msg_send![artwork_alloc, initWithImage: image];
    let _: () = msg_send![image, release];

    if artwork.is_null() {
        None
    } else {
        Some(LoadedArtwork {
            artwork,
            retained_image: 0,
        })
    }
}

unsafe fn set_string(info: *mut AnyObject, key: *mut AnyObject, value: &str) {
    if key.is_null() {
        return;
    }
    let value = NSString::from_str(value);
    let _: () = msg_send![info, setObject: &*value, forKey: key];
}

unsafe fn set_object(info: *mut AnyObject, key: *mut AnyObject, value: *mut AnyObject) {
    if key.is_null() || value.is_null() {
        return;
    }
    let _: () = msg_send![info, setObject: value, forKey: key];
}

unsafe fn set_number(info: *mut AnyObject, key: *mut AnyObject, value: f64) {
    if key.is_null() {
        return;
    }
    let number: *mut AnyObject = msg_send![class!(NSNumber), numberWithDouble: value];
    if number.is_null() {
        return;
    }
    let _: () = msg_send![info, setObject: number, forKey: key];
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn artwork_cache() -> &'static Mutex<ArtworkCache> {
    ARTWORK_CACHE.get_or_init(|| Mutex::new(ArtworkCache::default()))
}

unsafe fn clear_artwork_cache() {
    if let Ok(mut cache) = artwork_cache().lock() {
        release_cached_artwork(&mut cache);
        cache.url = None;
    }
}

unsafe fn release_cached_artwork(cache: &mut ArtworkCache) {
    if cache.artwork != 0 {
        let artwork = cache.artwork as *mut AnyObject;
        let _: () = msg_send![artwork, release];
        cache.artwork = 0;
    }
    if cache.retained_image != 0 {
        let image = cache.retained_image as *mut AnyObject;
        let _: () = msg_send![image, release];
        cache.retained_image = 0;
    }
}

unsafe fn media_action_imp(function: MediaActionImp) -> Imp {
    std::mem::transmute(function)
}

unsafe fn replace_method(class: *mut AnyClass, selector: Sel, imp: Imp, types: &'static [u8]) {
    let _ = ffi::class_replaceMethod(class, selector, imp, types.as_ptr().cast());
}

unsafe extern "C-unwind" fn media_play(
    _delegate: &AnyObject,
    _cmd: Sel,
    _sender: &AnyObject,
) -> isize {
    emit_media_command("play")
}

unsafe extern "C-unwind" fn media_pause(
    _delegate: &AnyObject,
    _cmd: Sel,
    _sender: &AnyObject,
) -> isize {
    emit_media_command("pause")
}

unsafe extern "C-unwind" fn media_toggle_play_pause(
    _delegate: &AnyObject,
    _cmd: Sel,
    _sender: &AnyObject,
) -> isize {
    emit_media_command("play_pause")
}

unsafe extern "C-unwind" fn media_previous(
    _delegate: &AnyObject,
    _cmd: Sel,
    _sender: &AnyObject,
) -> isize {
    emit_media_command("previous")
}

unsafe extern "C-unwind" fn media_next(
    _delegate: &AnyObject,
    _cmd: Sel,
    _sender: &AnyObject,
) -> isize {
    emit_media_command("next")
}

fn emit_media_command(command: &str) -> isize {
    if let Some(app) = MEDIA_APP_HANDLE.get() {
        crate::emit_system_media_command(app, command);
    }
    0
}
