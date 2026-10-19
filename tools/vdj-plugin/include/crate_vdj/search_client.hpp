#pragma once

#include "crate_vdj/credential_store.hpp"
#include "crate_vdj/http_client.hpp"
#include "crate_vdj/metadata_cache.hpp"
#include "crate_vdj/models.hpp"

#include <string>
#include <string_view>

namespace crate::vdj {

class SearchClient final {
public:
    SearchClient(
        HttpClient& http,
        CredentialStore& credentials,
        std::string allowed_origin,
        MetadataCacheStore* metadata_cache = nullptr
    );

    ParseResult<SearchResults> search(
        std::string_view query,
        const CancellationToken& cancellation
    );

private:
    HttpClient& http_;
    CredentialStore& credentials_;
    std::string allowed_origin_;
    MetadataCacheStore* metadata_cache_;
};

} // namespace crate::vdj
