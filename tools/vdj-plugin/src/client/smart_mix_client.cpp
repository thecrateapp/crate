#include "crate_vdj/smart_mix_client.hpp"

#include <cctype>
#include <string>
#include <utility>
#include <variant>

namespace crate::vdj {
namespace {

ParseResult<MixProfile> failure(ModelErrorCode code, std::string message)
{
    return ParseResult<MixProfile>{
        .value = std::nullopt,
        .error_code = code,
        .error = std::move(message),
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

ParseResult<MixProfile> unavailable_profile(std::string_view entity_uid)
{
    MixProfile profile;
    profile.track_entity_uid = entity_uid;
    profile.quality = MixProfileQuality::Unavailable;
    return ParseResult<MixProfile>{
        .value = std::move(profile),
        .error_code = ModelErrorCode::InvalidJson,
        .error = {},
    };
}

} // namespace

SmartMixClient::SmartMixClient(
    HttpClient& http,
    CredentialStore& credentials,
    std::string allowed_origin
)
    : http_(http)
    , credentials_(credentials)
    , allowed_origin_(std::move(allowed_origin))
{
}

ParseResult<MixProfile> SmartMixClient::fetch_summary(
    std::string_view entity_uid,
    const CancellationToken& cancellation
)
{
    if (cancellation.cancelled()) {
        return failure(ModelErrorCode::TransportError, "request cancelled");
    }
    if (entity_uid.empty() || entity_uid.find('/') != std::string_view::npos) {
        return failure(ModelErrorCode::InvalidField, "invalid track entity UID");
    }

    const auto token = credentials_.load_token();
    if (!token.has_value() || token->empty()) {
        return failure(
            ModelErrorCode::InvalidField,
            "VDJ access token is not configured"
        );
    }

    HttpRequest request{
        .method = "GET",
        .url = allowed_origin_ + "/api/tracks/by-entity/" +
            encode_path_segment(entity_uid) + "/mix-profile?detail=summary",
        .allowed_origin = allowed_origin_,
        .headers = {
            {"Accept", "application/json"},
            {"Authorization", "Bearer " + *token},
        },
        .cancellation = cancellation,
    };
    const auto response = http_.request(request);
    if (const auto* error = std::get_if<HttpError>(&response)) {
        if (error->code == HttpErrorCode::HttpStatus &&
            error->status_code == 404) {
            return unavailable_profile(entity_uid);
        }
        return failure(ModelErrorCode::TransportError, error->message);
    }

    const auto& http_response = std::get<HttpResponse>(response);
    if (http_response.status_code < 200 || http_response.status_code >= 300) {
        if (http_response.status_code == 404) {
            return unavailable_profile(entity_uid);
        }
        return failure(
            ModelErrorCode::InvalidResponse,
            "Smart Mix request returned HTTP " +
                std::to_string(http_response.status_code)
        );
    }
    return parse_mix_profile_json(http_response.body);
}

} // namespace crate::vdj
