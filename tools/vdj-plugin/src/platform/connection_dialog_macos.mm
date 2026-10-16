#include "connection_dialog.hpp"

#import <AppKit/AppKit.h>
#include <dispatch/dispatch.h>

namespace crate::vdj {
namespace {

NSString* to_ns(const std::string& value)
{
    return [NSString stringWithUTF8String:value.c_str()];
}

std::string from_ns(NSString* value)
{
    return value == nil ? std::string() : std::string([value UTF8String]);
}

void run_on_main(dispatch_block_t block)
{
    if ([NSThread isMainThread]) {
        block();
    } else {
        dispatch_sync(dispatch_get_main_queue(), block);
    }
}

} // namespace

ConnectionDialogResult show_connection_dialog(const ConnectionDialogRequest& request)
{
    __block ConnectionDialogResult result;
    run_on_main(^{
        @autoreleasepool {
            NSAlert* alert = [[NSAlert alloc] init];
            alert.messageText = @"Connect to Crate";
            alert.informativeText = to_ns(kConnectionDialogExplanation);
            [alert addButtonWithTitle:@"Connect"];
            [alert addButtonWithTitle:@"Cancel"];
            if (!request.current_origin.empty()) {
                [alert addButtonWithTitle:@"Disconnect"];
            }

            NSStackView* fields = [[NSStackView alloc] initWithFrame:NSMakeRect(0, 0, 320, 56)];
            fields.orientation = NSUserInterfaceLayoutOrientationVertical;
            fields.spacing = 8;
            NSTextField* origin = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 0, 320, 24)];
            origin.placeholderString = @"https://api.example.org";
            origin.stringValue = to_ns(request.current_origin);
            origin.accessibilityLabel = @"Crate server address";
            NSSecureTextField* token =
                [[NSSecureTextField alloc] initWithFrame:NSMakeRect(0, 0, 320, 24)];
            token.placeholderString = @"Access token";
            token.accessibilityLabel = @"Crate access token";
            [fields addView:origin inGravity:NSStackViewGravityTop];
            [fields addView:token inGravity:NSStackViewGravityTop];
            alert.accessoryView = fields;
            alert.window.initialFirstResponder = request.current_origin.empty() ? origin : token;

            const NSModalResponse response = [alert runModal];
            if (response == NSAlertFirstButtonReturn) {
                result.action = ConnectionDialogAction::Connect;
                result.origin = from_ns(origin.stringValue);
                result.token = from_ns(token.stringValue);
            } else if (response == NSAlertThirdButtonReturn) {
                result.action = ConnectionDialogAction::Disconnect;
            }
            token.stringValue = @"";
        }
    });
    return result;
}

void show_connection_message(const std::string& title, const std::string& message)
{
    const std::string title_copy = title;
    const std::string message_copy = message;
    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            NSAlert* alert = [[NSAlert alloc] init];
            alert.messageText = to_ns(title_copy);
            alert.informativeText = to_ns(message_copy);
            [alert addButtonWithTitle:@"OK"];
            [alert runModal];
        }
    });
}

} // namespace crate::vdj
