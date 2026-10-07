#include "crate_vdj/stream_resolver.hpp"

#include <cctype>
#include <string>
#include <utility>

namespace crate::vdj {
namespace {

ParseResult<std::string> failure(ModelErrorCode code, std::string message)
{
    return ParseResult<std::string>{
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

} // namespace

StreamResolver::StreamResolver(
    HttpClient& http,
    CredentialStore& credentials,
    std::string allowed_origin
)
    : http_(http)
    , credentials_(credentials)
    , allowed_origin_(std::move(allowed_origin))
    , media_access_client_(http_, allowed_origin_)
{
}

ParseResult<std::string> StreamResolver::resolve(
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

    const std::string encoded_entity_uid = encode_path_segment(entity_uid);
    HttpRequest playback_request{
        .method = "GET",
        .url = allowed_origin_ + "/api/vdj/tracks/by-entity/" +
            encoded_entity_uid + "/playback",
        .allowed_origin = allowed_origin_,
        .headers = {
            {"Accept", "application/json"},
            {"Authorization", "Bearer " + *token},
        },
        .cancellation = cancellation,
    };
    const auto playback_response = http_.request(playback_request);
    if (const auto* error = std::get_if<HttpError>(&playback_response)) {
        return failure(ModelErrorCode::TransportError, error->message);
    }

    const auto& playback = std::get<HttpResponse>(playback_response);
    if (playback.body.empty()) {
        return failure(
            ModelErrorCode::InvalidResponse,
            "playback response was empty"
        );
    }

    const std::string stream_path =
        "/api/vdj/tracks/by-entity/" + encoded_entity_uid + "/stream";
    return media_access_client_.issue_stream_url(
        stream_path,
        *token,
        cancellation
    );
}

} // namespace crate::vdj
