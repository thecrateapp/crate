#include "crate_vdj/connection_session.hpp"

#include <cctype>
#include <utility>

namespace crate::vdj {
namespace {

std::string_view trimmed(std::string_view value)
{
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.front()))) {
        value.remove_prefix(1);
    }
    while (!value.empty() && std::isspace(static_cast<unsigned char>(value.back()))) {
        value.remove_suffix(1);
    }
    return value;
}

bool keeps_session(ConnectionState state)
{
    return state == ConnectionState::Unreachable;
}

} // namespace

ConnectionSession::ConnectionSession(
    ConnectionSettingsStore& settings,
    CredentialFactory credential_factory,
    HttpClient& http,
    std::chrono::seconds refresh_interval
)
    : settings_(settings)
    , credential_factory_(std::move(credential_factory))
    , http_(http)
    , refresh_interval_(refresh_interval)
{
}

ConnectionStatus ConnectionSession::restore(
    Clock::time_point now,
    const CancellationToken& cancellation
)
{
    const auto origin = settings_.load_origin();
    std::shared_ptr<CredentialStore> credentials;
    if (origin.has_value()) {
        credentials = std::make_shared<CachedCredentialStore>(
            credential_factory_(credential_account_for_origin(*origin))
        );
    }
    {
        std::lock_guard lock(mutex_);
        origin_ = origin;
        credentials_ = credentials;
        status_ = {};
        if (!origin_.has_value()) {
            return status_;
        }
    }
    return check(*origin, credentials, now, cancellation);
}

ConnectResult ConnectionSession::connect(
    std::string_view origin_input,
    std::string_view token_input,
    Clock::time_point now,
    const CancellationToken& cancellation
)
{
    const auto origin = normalize_origin(origin_input);
    if (!origin.has_value()) {
        return {ConnectError::InvalidOrigin, {}};
    }
    const std::string token(trimmed(token_input));
    if (token.empty()) {
        return {ConnectError::MissingToken, {}};
    }

    const auto verified = CapabilityClient(http_, *origin).check(token, cancellation);
    if (cancellation.cancelled()) {
        return {ConnectError::Cancelled, verified};
    }
    if (verified.state != ConnectionState::Connected) {
        return {ConnectError::Rejected, verified};
    }

    auto credentials = std::make_shared<CachedCredentialStore>(
        credential_factory_(credential_account_for_origin(*origin))
    );
    std::lock_guard lock(mutex_);
    if (cancellation.cancelled()) {
        return {ConnectError::Cancelled, verified};
    }
    if (!credentials->save_token(token)) {
        return {ConnectError::CredentialWriteFailed, verified};
    }
    if (!settings_.save_origin(*origin)) {
        credentials->clear_token();
        return {ConnectError::SettingsWriteFailed, verified};
    }
    if (origin_.has_value() && *origin_ != *origin && credentials_ != nullptr) {
        credentials_->clear_token();
    }
    origin_ = *origin;
    credentials_ = std::move(credentials);
    status_ = verified;
    last_check_ = now;
    return {ConnectError::None, status_};
}

bool ConnectionSession::disconnect()
{
    std::lock_guard lock(mutex_);
    bool ok = settings_.clear();
    if (credentials_ != nullptr) {
        ok = credentials_->clear_token() && ok;
    }
    origin_.reset();
    credentials_.reset();
    status_ = {};
    return ok;
}

ConnectionStatus ConnectionSession::refresh_if_due(
    Clock::time_point now,
    const CancellationToken& cancellation
)
{
    std::string origin;
    std::shared_ptr<CredentialStore> credentials;
    {
        std::lock_guard lock(mutex_);
        if (credentials_ == nullptr || status_.state != ConnectionState::Connected ||
            now - last_check_ < refresh_interval_) {
            return status_;
        }
        origin = *origin_;
        credentials = credentials_;
    }
    return check(origin, credentials, now, cancellation);
}

ConnectionStatus ConnectionSession::check(
    const std::string& origin,
    const std::shared_ptr<CredentialStore>& credentials,
    Clock::time_point now,
    const CancellationToken& cancellation
)
{
    const auto token = credentials->load_token();
    ConnectionStatus checked;
    if (!token.has_value() || token->empty()) {
        checked.state = ConnectionState::Unauthorized;
        checked.message = "no access token saved for this server";
    } else {
        checked = CapabilityClient(http_, origin).check(*token, cancellation);
    }

    std::lock_guard lock(mutex_);
    if (credentials_ != credentials || cancellation.cancelled()) {
        return status_;
    }
    last_check_ = now;
    if (keeps_session(checked.state) && status_.state == ConnectionState::Connected) {
        return status_;
    }
    status_ = std::move(checked);
    return status_;
}

ConnectionStatus ConnectionSession::status() const
{
    std::lock_guard lock(mutex_);
    return status_;
}

bool ConnectionSession::logged_in() const
{
    std::lock_guard lock(mutex_);
    return status_.state == ConnectionState::Connected && status_.features.online_source;
}

std::optional<std::string> ConnectionSession::origin() const
{
    std::lock_guard lock(mutex_);
    return origin_;
}

std::shared_ptr<CredentialStore> ConnectionSession::credentials() const
{
    std::lock_guard lock(mutex_);
    return credentials_;
}

} // namespace crate::vdj
