#pragma once

#include "crate_vdj/capability_client.hpp"
#include "crate_vdj/connection_settings.hpp"
#include "crate_vdj/credential_store.hpp"
#include "crate_vdj/http_client.hpp"

#include <chrono>
#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>

namespace crate::vdj {

enum class ConnectError {
    None,
    InvalidOrigin,
    MissingToken,
    Rejected,
    CredentialWriteFailed,
    SettingsWriteFailed,
    Cancelled,
};

struct ConnectResult {
    ConnectError error = ConnectError::None;
    ConnectionStatus status;
};

class ConnectionSession {
public:
    using CredentialFactory =
        std::function<std::unique_ptr<CredentialStore>(const std::string& account)>;
    using Clock = std::chrono::steady_clock;

    ConnectionSession(
        ConnectionSettingsStore& settings,
        CredentialFactory credential_factory,
        HttpClient& http,
        std::chrono::seconds refresh_interval = std::chrono::minutes(10)
    );

    ConnectionStatus restore(Clock::time_point now, const CancellationToken& cancellation);
    ConnectResult connect(
        std::string_view origin,
        std::string_view token,
        Clock::time_point now,
        const CancellationToken& cancellation
    );
    bool disconnect();
    ConnectionStatus refresh_if_due(Clock::time_point now, const CancellationToken& cancellation);

    ConnectionStatus status() const;
    bool logged_in() const;
    std::optional<std::string> origin() const;
    std::shared_ptr<CredentialStore> credentials() const;

private:
    ConnectionStatus check(
        const std::string& origin,
        const std::shared_ptr<CredentialStore>& credentials,
        Clock::time_point now,
        const CancellationToken& cancellation
    );

    ConnectionSettingsStore& settings_;
    CredentialFactory credential_factory_;
    HttpClient& http_;
    std::chrono::seconds refresh_interval_;
    mutable std::mutex mutex_;
    std::optional<std::string> origin_;
    std::shared_ptr<CredentialStore> credentials_;
    ConnectionStatus status_;
    Clock::time_point last_check_{};
};

} // namespace crate::vdj
