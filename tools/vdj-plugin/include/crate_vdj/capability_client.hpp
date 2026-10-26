#pragma once

#include "crate_vdj/http_client.hpp"

#include <string>
#include <string_view>
#include <vector>

namespace crate::vdj {

enum class ConnectionState {
    Disconnected,
    Connected,
    Unauthorized,
    MissingScopes,
    Incompatible,
    ServerDisabled,
    Unreachable,
};

struct ConnectionIdentity {
    std::string username;
    std::string name;
    std::string email;
    std::vector<std::string> scopes;
};

struct ConnectionFeatures {
    bool online_source = false;
    bool smart_mix_assistant = false;
    bool automation = false;
};

struct ConnectionStatus {
    ConnectionState state = ConnectionState::Disconnected;
    ConnectionIdentity identity;
    ConnectionFeatures features;
    std::string message;
};

class CapabilityClient {
public:
    CapabilityClient(HttpClient& http, std::string origin);

    ConnectionStatus check(std::string_view token, const CancellationToken& cancellation);

private:
    HttpClient& http_;
    std::string origin_;
};

} // namespace crate::vdj
