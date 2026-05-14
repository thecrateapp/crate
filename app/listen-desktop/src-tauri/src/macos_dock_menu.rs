use std::{ptr, sync::OnceLock};

use objc2::{
    ffi,
    rc::Retained,
    runtime::{AnyClass, AnyObject, Imp, Sel},
    sel, MainThreadOnly,
};
use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem};
use objc2_foundation::{MainThreadMarker, NSString};

static DOCK_APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

type DockMenuImp = unsafe extern "C-unwind" fn(&AnyObject, Sel, &NSApplication) -> *mut NSMenu;
type DockActionImp = unsafe extern "C-unwind" fn(&AnyObject, Sel, &AnyObject);

pub fn install(app: &tauri::App) {
    let _ = DOCK_APP_HANDLE.set(app.handle().clone());
    let _ = app.handle().run_on_main_thread(|| unsafe {
        patch_application_delegate();
    });
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
        sel!(applicationDockMenu:),
        dock_menu_imp(application_dock_menu),
        b"@@:@\0",
    );
    replace_method(
        class,
        sel!(crateDockPlayPause:),
        dock_action_imp(dock_play_pause),
        b"v@:@\0",
    );
    replace_method(
        class,
        sel!(crateDockPrevious:),
        dock_action_imp(dock_previous),
        b"v@:@\0",
    );
    replace_method(
        class,
        sel!(crateDockNext:),
        dock_action_imp(dock_next),
        b"v@:@\0",
    );
}

unsafe fn dock_menu_imp(function: DockMenuImp) -> Imp {
    std::mem::transmute(function)
}

unsafe fn dock_action_imp(function: DockActionImp) -> Imp {
    std::mem::transmute(function)
}

unsafe fn replace_method(class: *mut AnyClass, selector: Sel, imp: Imp, types: &'static [u8]) {
    let _ = ffi::class_replaceMethod(class, selector, imp, types.as_ptr().cast());
}

unsafe extern "C-unwind" fn application_dock_menu(
    delegate: &AnyObject,
    _cmd: Sel,
    _sender: &NSApplication,
) -> *mut NSMenu {
    let Some(mtm) = MainThreadMarker::new() else {
        return ptr::null_mut();
    };
    let title = NSString::from_str("Crate");
    let menu = NSMenu::initWithTitle(NSMenu::alloc(mtm), &title);

    menu.addItem(&dock_item(
        mtm,
        "Play / Pause",
        sel!(crateDockPlayPause:),
        delegate,
    ));
    menu.addItem(&dock_item(
        mtm,
        "Previous",
        sel!(crateDockPrevious:),
        delegate,
    ));
    menu.addItem(&dock_item(mtm, "Next", sel!(crateDockNext:), delegate));

    Retained::autorelease_return(menu)
}

fn dock_item(
    mtm: MainThreadMarker,
    title: &str,
    action: Sel,
    target: &AnyObject,
) -> Retained<NSMenuItem> {
    let title = NSString::from_str(title);
    let key_equivalent = NSString::from_str("");
    let item = unsafe {
        NSMenuItem::initWithTitle_action_keyEquivalent(
            NSMenuItem::alloc(mtm),
            &title,
            Some(action),
            &key_equivalent,
        )
    };
    unsafe {
        item.setTarget(Some(target));
    }
    item
}

unsafe extern "C-unwind" fn dock_play_pause(_delegate: &AnyObject, _cmd: Sel, _sender: &AnyObject) {
    emit_dock_command("play_pause");
}

unsafe extern "C-unwind" fn dock_previous(_delegate: &AnyObject, _cmd: Sel, _sender: &AnyObject) {
    emit_dock_command("previous");
}

unsafe extern "C-unwind" fn dock_next(_delegate: &AnyObject, _cmd: Sel, _sender: &AnyObject) {
    emit_dock_command("next");
}

fn emit_dock_command(command: &str) {
    if let Some(app) = DOCK_APP_HANDLE.get() {
        super::handle_playback_menu_event(app, command);
    }
}
