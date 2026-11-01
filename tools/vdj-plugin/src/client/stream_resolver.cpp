#include "crate_vdj/stream_resolver.hpp"

#include "crate_vdj/json_mapping.hpp"

#include <cctype>
#include <string>
#include <utility>

namespace crate::vdj {
namespace {

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

StreamFailure playback_failure(const HttpResponse& response, std::string_view entity_uid)
{
    if (response.status_code != 200) {
        return StreamFailure::Invalid;
    }
    const auto parsed = json::parse_object(response.body);
    if (!parsed.ok()) {
        return StreamFailure::Invalid;
    }
    const auto& root = *parsed.value;
    std::string returned_uid;
    std::string origin;
    std::string format;
    bool preparing = true;
    const auto* delivery = json::member(root, "delivery");
    if (!json::required_string(root, "entity_uid", returned_uid) || returned_uid != entity_uid ||
        !json::required_string(root, "content_origin", origin) || origin != "local" ||
        !json::required_boolean(root, "preparing", preparing) || delivery == nullptr ||
        !json::required_string(*delivery, "format", format)) {
        return StreamFailure::Invalid;
    }
    return preparing ? StreamFailure::NotReady : StreamFailure::None;
}

std::chrono::milliseconds remaining_until(std::chrono::steady_clock::time_point deadline)
{
    return std::chrono::duration_cast<std::chrono::milliseconds>(
        deadline - std::chrono::steady_clock::now()
    );
}

} // namespace

StreamResolver::StreamResolver(
    HttpClient& http,
    CredentialStore& credentials,
    std::string allowed_origin,
    std::chrono::milliseconds budget
)
    : http_(http)
    , credentials_(credentials)
    , allowed_origin_(std::move(allowed_origin))
    , budget_(budget)
    , media_access_client_(http_, allowed_origin_)
{
}

StreamResolution StreamResolver::resolve(
    std::string_view entity_uid,
    const CancellationToken& cancellation
)
{
    const auto deadline = std::chrono::steady_clock::now() + budget_;
    if (cancellation.cancelled()) {
        return stream_failure(StreamFailure::Cancelled, "request cancelled");
    }
    if (entity_uid.empty() || entity_uid.find('/') != std::string_view::npos) {
        return stream_failure(StreamFailure::Invalid, "invalid track entity UID");
    }

    const auto token = credentials_.load_token();
    if (!token.has_value() || token->empty()) {
        return stream_failure(StreamFailure::Unauthorized, "VDJ access token is not configured");
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
        .timeout = remaining_until(deadline),
        .cancellation = cancellation,
    };
    const auto playback_response = http_.request(playback_request);
    if (const auto* error = std::get_if<HttpError>(&playback_response)) {
        return stream_failure(*error);
    }
    const auto playback = playback_failure(std::get<HttpResponse>(playback_response), entity_uid);
    if (playback == StreamFailure::NotReady) {
        return stream_failure(playback, "the track is still being prepared");
    }
    if (playback != StreamFailure::None) {
        return stream_failure(playback, "playback response is not a ready local track");
    }

    const auto remaining = remaining_until(deadline);
    if (remaining <= std::chrono::milliseconds::zero()) {
        return stream_failure(StreamFailure::TimedOut, "stream resolution ran out of time");
    }
    const std::string stream_path =
        "/api/vdj/tracks/by-entity/" + encoded_entity_uid + "/stream";
    return media_access_client_.issue_stream_url(stream_path, *token, cancellation, remaining);
}

} // namespace crate::vdj
