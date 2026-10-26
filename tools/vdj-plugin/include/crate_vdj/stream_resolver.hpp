#pragma once

#include "crate_vdj/credential_store.hpp"
#include "crate_vdj/http_client.hpp"
#include "crate_vdj/media_access_client.hpp"
#include "crate_vdj/models.hpp"

#include <string>
#include <string_view>

namespace crate::vdj {

class StreamResolver final {
public:
    StreamResolver(
        HttpClient& http,
        CredentialStore& credentials,
        std::string allowed_origin
    );

    ParseResult<std::string> resolve(
        std::string_view entity_uid,
        const CancellationToken& cancellation
    );

private:
    HttpClient& http_;
    CredentialStore& credentials_;
    std::string allowed_origin_;
    MediaAccessClient media_access_client_;
};

} // namespace crate::vdj
