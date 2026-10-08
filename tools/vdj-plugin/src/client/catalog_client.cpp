#include "crate_vdj/catalog_client.hpp"

#include <cctype>
#include <chrono>
#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <variant>

namespace crate::vdj {
namespace {

ParseResult<CatalogResults> failure(ModelErrorCode code, std::string message)
{
    return ParseResult<CatalogResults>{
        .value = std::nullopt,
        .error_code = code,
        .error = std::move(message),
    };
}

std::int64_t now_seconds()
{
    return std::chrono::duration_cast<std::chrono::seconds>(
               std::chrono::system_clock::now().time_since_epoch()
           )
        .count();
}

ParseResult<CatalogResults> from_cache(CatalogResults results)
{
    return ParseResult<CatalogResults>{
        .value = std::move(results),
        .error_code = ModelErrorCode::InvalidJson,
        .error = {},
    };
}

std::string encode_path_segment(std::string_view value)
{
    constexpr char hex[] = "0123456789ABCDEF";
    std::string encoded;
    encoded.reserve(value.size());
    for (const unsigned char character : value) {
        const bool unreserved = std::isalnum(character) != 0 ||
            character == '-' || character == '.' || character == '_' ||
            character == '~';
        if (unreserved) {
            encoded.push_back(static_cast<char>(character));
            continue;
        }
        encoded.push_back('%');
        encoded.push_back(hex[character >> 4]);
        encoded.push_back(hex[character & 0x0F]);
    }
    return encoded;
}

} // namespace

CatalogClient::CatalogClient(
    HttpClient& http,
    CredentialStore& credentials,
    std::string allowed_origin,
    MetadataCacheStore* metadata_cache
)
    : http_(http)
    , credentials_(credentials)
    , allowed_origin_(std::move(allowed_origin))
    , metadata_cache_(metadata_cache)
{
}

ParseResult<CatalogResults> CatalogClient::list_folders(
    const CancellationToken& cancellation
)
{
    return request(
        allowed_origin_ + "/api/vdj/catalog/folders",
        "folders",
        cancellation
    );
}

ParseResult<CatalogResults> CatalogClient::get_folder(
    std::string_view folder_id,
    std::string_view cursor,
    const CancellationToken& cancellation
)
{
    if (folder_id.empty()) {
        return failure(ModelErrorCode::InvalidField, "folder ID is empty");
    }

    std::string url = allowed_origin_ + "/api/vdj/catalog/folders/" +
        encode_path_segment(folder_id) + "?";
    if (!cursor.empty()) {
        url += "cursor=" + encode_path_segment(cursor) + "&";
    }
    url += "limit=100";
    return request(
        std::move(url),
        "folder:" + std::string(folder_id) + ":cursor:" +
            std::string(cursor),
        cancellation
    );
}

ParseResult<CatalogResults> CatalogClient::request(
    std::string url,
    std::string_view request_key,
    const CancellationToken& cancellation
)
{
    if (cancellation.cancelled()) {
        return failure(ModelErrorCode::TransportError, "request cancelled");
    }

    const auto token = credentials_.load_token();
    if (!token.has_value() || token->empty()) {
        return failure(
            ModelErrorCode::InvalidField,
            "VDJ access token is not configured"
        );
    }

    const MetadataCacheScope cache_scope{
        .origin = allowed_origin_,
        .account_key = metadata_cache_account_key(*token),
    };
    std::optional<CatalogResults> stale_results;
    if (metadata_cache_ != nullptr) {
        auto cached = metadata_cache_->get_catalog(
            cache_scope,
            request_key,
            now_seconds()
        );
        if (cached.state == CacheState::Fresh && cached.value.has_value()) {
            return from_cache(std::move(*cached.value));
        }
        if (cached.state == CacheState::Stale && cached.value.has_value()) {
            stale_results = std::move(*cached.value);
        }
    }

    HttpRequest request{
        .method = "GET",
        .url = std::move(url),
        .allowed_origin = allowed_origin_,
        .headers = {
            {"Accept", "application/json"},
            {"Authorization", "Bearer " + *token},
        },
        .cancellation = cancellation,
    };
    const auto response = http_.request(request);
    if (const auto* error = std::get_if<HttpError>(&response)) {
        if (stale_results.has_value()) {
            return from_cache(std::move(*stale_results));
        }
        return failure(ModelErrorCode::TransportError, error->message);
    }

    const auto& http_response = std::get<HttpResponse>(response);
    if (http_response.status_code < 200 || http_response.status_code >= 300) {
        if (stale_results.has_value()) {
            return from_cache(std::move(*stale_results));
        }
        return failure(
            ModelErrorCode::InvalidResponse,
            "catalog request returned HTTP " +
                std::to_string(http_response.status_code)
        );
    }
    auto parsed = parse_catalog_json(http_response.body);
    if (parsed.ok()) {
        if (metadata_cache_ != nullptr) {
            metadata_cache_->put_catalog(
                cache_scope,
                request_key,
                *parsed.value,
                now_seconds()
            );
        }
        return parsed;
    }
    if (stale_results.has_value()) {
        return from_cache(std::move(*stale_results));
    }
    return parsed;
}

} // namespace crate::vdj
