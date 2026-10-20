#include "probe_platform.hpp"

#import <AppKit/AppKit.h>

#include <memory>
#include <utility>

@interface CrateProbeLoginController : NSObject
@property(nonatomic, strong) NSWindow* window;
@property(nonatomic, copy) void (^onClosed)(BOOL connected);
- (void)connect:(id)sender;
- (void)cancel:(id)sender;
@end

@implementation CrateProbeLoginController
- (void)finish:(BOOL)connected
{
    [self.window orderOut:nil];
    if (self.onClosed != nil) {
        self.onClosed(connected);
    }
    self.onClosed = nil;
}
- (void)connect:(id)sender
{
    (void)sender;
    [self finish:YES];
}
- (void)cancel:(id)sender
{
    (void)sender;
    [self finish:NO];
}
@end

static CrateProbeLoginController* g_controller = nil;

static void open_window(
    std::shared_ptr<std::function<void(bool)>> on_closed,
    std::shared_ptr<std::function<void(const std::string&)>> log
)
{
    NSWindow* window = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(0, 0, 360, 140)
                  styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable
                    backing:NSBackingStoreBuffered
                      defer:NO];
    window.title = @"Crate Probe login";
    window.releasedWhenClosed = NO;

    NSTextField* label = [NSTextField labelWithString:
        @"VH01 probe: does a native window open from OnLogin?"];
    label.frame = NSMakeRect(20, 90, 320, 24);
    [window.contentView addSubview:label];

    CrateProbeLoginController* controller = [[CrateProbeLoginController alloc] init];
    controller.window = window;
    controller.onClosed = ^(BOOL connected) {
        (*on_closed)(connected == YES);
    };

    NSButton* connect = [NSButton buttonWithTitle:@"Simulate connect"
                                           target:controller
                                           action:@selector(connect:)];
    connect.frame = NSMakeRect(190, 20, 150, 32);
    [window.contentView addSubview:connect];

    NSButton* cancel = [NSButton buttonWithTitle:@"Cancel"
                                          target:controller
                                          action:@selector(cancel:)];
    cancel.frame = NSMakeRect(20, 20, 120, 32);
    [window.contentView addSubview:cancel];

    g_controller = controller;
    [window center];
    [window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    (*log)("window shown");
}

void crate_probe_open_login_window(
    std::function<void(bool)> on_closed,
    std::function<void(const std::string&)> log
)
{
    auto shared_closed = std::make_shared<std::function<void(bool)>>(std::move(on_closed));
    auto shared_log = std::make_shared<std::function<void(const std::string&)>>(std::move(log));
    if ([NSThread isMainThread]) {
        (*shared_log)("OnLogin ran on the main thread; opening directly");
        open_window(shared_closed, shared_log);
        return;
    }
    (*shared_log)("OnLogin ran off the main thread; dispatching to main");
    dispatch_async(dispatch_get_main_queue(), ^{
        open_window(shared_closed, shared_log);
    });
}
