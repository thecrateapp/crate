#include "crate_vdj/credential_store.hpp"

#include <regex>
#include <string>

namespace crate::vdj {
namespace {

void replace_all(
    std::string& output,
    std::string_view needle,
    std::string_view replacement
)
{
    if (needle.empty()) {
        return;
    }

    std::size_t position = 0;
    while ((position = output.find(needle, position)) != std::string::npos) {
        output.replace(position, needle.size(), replacement);
        position += replacement.size();
    }
}

} // namespace

std::string redact_secrets(std::string_view message)
{
    static const std::regex json_secret(
        R"re(("(?:ticket|token|refresh_token|access_token|media_ticket)"\s*:\s*")[^"]*")re"
    );
    static const std::regex bearer(R"re((Bearer\s+)[^\s"']+)re");
    static const std::regex access_token(R"re(crv_[A-Za-z0-9_\-]+)re");
    static const std::regex query_ticket(R"re(((?:media_)?ticket=)[^&\s"']+)re");

    std::string result(message);
    result = std::regex_replace(result, json_secret, "$1[REDACTED]\"");
    result = std::regex_replace(result, bearer, "$1[REDACTED]");
    result = std::regex_replace(result, access_token, "crv_[REDACTED]");
    result = std::regex_replace(result, query_ticket, "$1[REDACTED]");
    return result;
}

std::string redact_sensitive(
    std::string_view message,
    std::string_view bearer_token,
    std::string_view media_ticket,
    std::string_view signed_url
)
{
    std::string result(message);
    replace_all(result, bearer_token, "[REDACTED]");
    replace_all(result, media_ticket, "[REDACTED]");
    replace_all(result, signed_url, "[REDACTED]");
    return redact_secrets(result);
}

} // namespace crate::vdj
