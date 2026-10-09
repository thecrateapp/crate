#pragma once

#include <string>

namespace crate::vdj {

enum class ConnectionDialogAction {
    Cancel,
    Connect,
    Disconnect,
};

struct ConnectionDialogRequest {
    std::string current_origin;
};

struct ConnectionDialogResult {
    ConnectionDialogAction action = ConnectionDialogAction::Cancel;
    std::string origin;
    std::string token;
};

ConnectionDialogResult show_connection_dialog(const ConnectionDialogRequest& request);
void show_connection_message(const std::string& title, const std::string& message);

inline constexpr const char* kConnectionDialogExplanation =
    "Connect VirtualDJ to your Crate server. Create an access token in Crate Listen, "
    "Settings, Access tokens. The Crate plugin requires a VirtualDJ Pro license.";

} // namespace crate::vdj
