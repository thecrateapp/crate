#pragma once

#include <optional>
#include <string>
#include <string_view>

namespace crate::vdj {

class CredentialStore {
public:
    virtual ~CredentialStore() = default;
    virtual std::optional<std::string> load_token() = 0;
    virtual void save_token(std::string token) = 0;
    virtual void clear_token() = 0;
};

class SystemCredentialStore final : public CredentialStore {
public:
    SystemCredentialStore(std::string service, std::string account);

    std::optional<std::string> load_token() override;
    void save_token(std::string token) override;
    void clear_token() override;

private:
    std::string service_;
    std::string account_;
};

std::string redact_sensitive(
    std::string_view message,
    std::string_view bearer_token = {},
    std::string_view media_ticket = {},
    std::string_view signed_url = {}
);

} // namespace crate::vdj
