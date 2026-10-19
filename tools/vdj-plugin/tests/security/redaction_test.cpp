#include "crate_vdj/credential_store.hpp"

#include "../support/check.hpp"

#include <string>

using namespace crate::vdj;

namespace {

bool contains(const std::string& text, std::string_view needle)
{
    return text.find(needle) != std::string::npos;
}

} // namespace

int main()
{
    const auto header = redact_secrets("Authorization: Bearer crv_AbC-123_xyz retry");
    CRATE_CHECK(!contains(header, "crv_AbC-123_xyz"));
    CRATE_CHECK(contains(header, "retry"));

    const auto url = redact_secrets(
        "GET https://api.example/api/vdj/tracks/by-entity/t1/stream?media_ticket=mt.secret-Value&x=1 failed"
    );
    CRATE_CHECK(!contains(url, "mt.secret-Value"));
    CRATE_CHECK(contains(url, "/api/vdj/tracks/by-entity/t1/stream"));
    CRATE_CHECK(contains(url, "failed"));

    const auto body = redact_secrets(
        R"json({"tickets":[{"ticket":"opaque-secret","path":"/p"}],"token":"crv_issued"})json"
    );
    CRATE_CHECK(!contains(body, "opaque-secret"));
    CRATE_CHECK(!contains(body, "crv_issued"));
    CRATE_CHECK(contains(body, "\"path\":\"/p\""));

    const auto bare = redact_secrets("token crv_standalone_secret in message");
    CRATE_CHECK(!contains(bare, "crv_standalone_secret"));

    const std::string harmless = "search query=post punk returned 3 tracks";
    CRATE_CHECK(redact_secrets(harmless) == harmless);
}
