#include "crate_vdj/search_client.hpp"

#include <array>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <variant>

namespace crate::vdj {
namespace {

bool is_unreserved(unsigned char character)
{
    return std::isalnum(character) != 0 || character == '-' ||
        character == '.' || character == '_' || character == '~';
}

std::string encode_query(std::string_view query)
{
    constexpr std::array<char, 16> hex = {
        '0', '1', '2', '3', '4', '5', '6', '7',
        '8', '9', 'A', 'B', 'C', 'D', 'E', 'F',
    };

    std::string encoded;
    encoded.reserve(query.size());
    for (const unsigned char character : query) {
        if (is_unreserved(character)) {
            encoded.push_back(static_cast<char>(character));
            continue;
        }
        encoded.push_back('%');
        encoded.push_back(hex[character >> 4]);
        encoded.push_back(hex[character & 0x0F]);
    }
    return encoded;
}

ParseResult<SearchResults> failure(ModelErrorCode code, std::string message)
{
    return ParseResult<SearchResults>{
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

ParseResult<SearchResults> from_cache(SearchResults results)
{
    return ParseResult<SearchResults>{
        .value = std::move(results),
        .error_code = ModelErrorCode::InvalidJson,
        .error = {},
    };
}

} // namespace

SearchClient::SearchClient(
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

ParseResult<SearchResults> SearchClient::search(
    std::string_view query,
    const CancellationToken& cancellation
)
{
    if (query.empty()) {
        return failure(ModelErrorCode::InvalidField, "search query is empty");
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
    std::optional<SearchResults> stale_results;
    if (metadata_cache_ != nullptr) {
        auto cached = metadata_cache_->get_search(
            cache_scope,
            query,
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
        .url = allowed_origin_ + "/api/search?q=" + encode_query(query) +
            "&scope=local&limit=50",
        .allowed_origin = allowed_origin_,
        .headers = {
            {"Accept", "application/json"},
            {"Authorization", "Bearer " + *token},
        },
        .cancellation = cancellation,
    };

    const auto response = http_.request(request);
    if (const auto* error = std::get_if<HttpError>(&response)) {
        if (stale_results.has_value() && allows_stale_fallback(*error)) {
            return from_cache(std::move(*stale_results));
        }
        return failure(ModelErrorCode::TransportError, error->message);
    }

    const auto& http_response = std::get<HttpResponse>(response);
    auto parsed = parse_search_json(http_response.body);
    if (parsed.ok()) {
        if (metadata_cache_ != nullptr) {
            metadata_cache_->put_search(
                cache_scope,
                query,
                *parsed.value,
                now_seconds()
            );
        }
        return parsed;
    }
    return parsed;
}

} // namespace crate::vdj
