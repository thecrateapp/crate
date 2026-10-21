#pragma once

#include "crate_vdj/credential_store.hpp"
#include "crate_vdj/http_client.hpp"
#include "crate_vdj/mix_profile.hpp"

#include <string>
#include <string_view>

namespace crate::vdj {

class SmartMixClient final {
public:
    SmartMixClient(
        HttpClient& http,
        CredentialStore& credentials,
        std::string allowed_origin
    );

    ParseResult<MixProfile> fetch_summary(
        std::string_view entity_uid,
        const CancellationToken& cancellation
    );

private:
    HttpClient& http_;
    CredentialStore& credentials_;
    std::string allowed_origin_;
};

} // namespace crate::vdj
