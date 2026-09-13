//! Shared helpers for patching (swizzling) selectors onto the running
//! app's `NSApplicationDelegate`. `macos_media_controls` (media keys,
//! remote command center) and `macos_dock_menu` (dock menu) each need to
//! add their own Objective-C method implementations to that same
//! delegate instance, and previously duplicated the exact same
//! lookup/replace boilerplate to do it.

use objc2::{
    ffi,
    runtime::{AnyClass, AnyObject, Imp, Sel},
};
use objc2_app_kit::NSApplication;
use objc2_foundation::MainThreadMarker;

/// Returns the running app's delegate object, or `None` off the main
/// thread or before AppKit has one. Callers cast `.class()` off this to
/// swizzle selectors, or pass it on as an Objective-C message target.
pub(crate) unsafe fn app_delegate() -> Option<*mut AnyObject> {
    let mtm = MainThreadMarker::new()?;
    let app = NSApplication::sharedApplication(mtm);
    let delegate = app.delegate()?;
    let delegate_ref = &*delegate;
    let delegate_object: &AnyObject = delegate_ref.as_ref();
    Some(delegate_object as *const AnyObject as *mut AnyObject)
}

pub(crate) unsafe fn replace_method(
    class: *mut AnyClass,
    selector: Sel,
    imp: Imp,
    types: &'static [u8],
) {
    let _ = ffi::class_replaceMethod(class, selector, imp, types.as_ptr().cast());
}
