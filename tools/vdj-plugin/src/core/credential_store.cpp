#include "crate_vdj/credential_store.hpp"

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
    return result;
}

} // namespace crate::vdj
