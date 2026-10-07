#pragma once

#include "crate_vdj/credential_store.hpp"
#include "crate_vdj/http_client.hpp"
#include "crate_vdj/metadata_cache.hpp"
#include "crate_vdj/models.hpp"

#include <string>
#include <string_view>

namespace crate::vdj {

class CatalogClient final {
public:
    CatalogClient(
        HttpClient& http,
        CredentialStore& credentials,
        std::string allowed_origin,
        MetadataCacheStore* metadata_cache = nullptr
    );

    ParseResult<CatalogResults> list_folders(
        const CancellationToken& cancellation
    );

    ParseResult<CatalogResults> get_folder(
        std::string_view folder_id,
        std::string_view cursor,
        const CancellationToken& cancellation
    );

private:
    ParseResult<CatalogResults> request(
        std::string url,
        std::string_view request_key,
        const CancellationToken& cancellation
    );

    HttpClient& http_;
    CredentialStore& credentials_;
    std::string allowed_origin_;
    MetadataCacheStore* metadata_cache_;
};

} // namespace crate::vdj
