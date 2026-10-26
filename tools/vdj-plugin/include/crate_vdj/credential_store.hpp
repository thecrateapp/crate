#pragma once

#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>

namespace crate::vdj {

class CredentialStore {
public:
    virtual ~CredentialStore() = default;
    virtual std::optional<std::string> load_token() = 0;
    virtual bool save_token(std::string token) = 0;
    virtual bool clear_token() = 0;
};

class SystemCredentialStore final : public CredentialStore {
public:
    SystemCredentialStore(std::string service, std::string account);

    std::optional<std::string> load_token() override;
    bool save_token(std::string token) override;
    bool clear_token() override;

private:
    std::string service_;
    std::string account_;
};

class CachedCredentialStore final : public CredentialStore {
public:
    explicit CachedCredentialStore(std::unique_ptr<CredentialStore> backing);

    std::optional<std::string> load_token() override;
    bool save_token(std::string token) override;
    bool clear_token() override;

private:
    std::unique_ptr<CredentialStore> backing_;
    std::mutex mutex_;
    bool loaded_ = false;
    std::optional<std::string> token_;
};

inline constexpr std::string_view kCredentialService = "org.cratemusic.virtualdj";

std::string credential_account_for_origin(std::string_view origin);

std::string redact_secrets(std::string_view message);

std::string redact_sensitive(
    std::string_view message,
    std::string_view bearer_token = {},
    std::string_view media_ticket = {},
    std::string_view signed_url = {}
);

} // namespace crate::vdj
