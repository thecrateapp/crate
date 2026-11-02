#include "crate_vdj/media_access_client.hpp"

#include "crate_vdj/json_mapping.hpp"

#include <cctype>
#include <string>
#include <utility>

namespace crate::vdj {
namespace {

bool is_stream_path(std::string_view path)
{
    return path.starts_with("/api/vdj/tracks/by-entity/") &&
        path.ends_with("/stream") && path.find('?') == std::string_view::npos;
}

std::string encode_query_value(std::string_view value)
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

MediaAccessClient::MediaAccessClient(
    HttpClient& http,
    std::string allowed_origin
)
    : http_(http)
    , allowed_origin_(std::move(allowed_origin))
{
}

StreamResolution stream_failure(StreamFailure failure, std::string detail)
{
    return StreamResolution{.url = std::nullopt, .failure = failure, .detail = std::move(detail)};
}

StreamResolution stream_failure(const HttpError& error)
{
    switch (error.code) {
    case HttpErrorCode::Cancelled:
        return stream_failure(StreamFailure::Cancelled, error.message);
    case HttpErrorCode::Timeout:
        return stream_failure(StreamFailure::TimedOut, error.message);
    case HttpErrorCode::HttpStatus:
        if (error.status_code == 401 || error.status_code == 403) {
            return stream_failure(StreamFailure::Unauthorized, error.message);
        }
        if (error.status_code == 404) {
            return stream_failure(StreamFailure::NotFound, error.message);
        }
        return stream_failure(StreamFailure::Unreachable, error.message);
    case HttpErrorCode::Network:
        return stream_failure(StreamFailure::Unreachable, error.message);
    case HttpErrorCode::InvalidResponse:
        break;
    }
    return stream_failure(StreamFailure::Invalid, error.message);
}

StreamResolution MediaAccessClient::issue_stream_url(
    std::string_view path,
    std::string_view bearer_token,
    const CancellationToken& cancellation,
    std::chrono::milliseconds timeout
)
{
    if (cancellation.cancelled()) {
        return stream_failure(StreamFailure::Cancelled, "request cancelled");
    }
    if (!is_stream_path(path)) {
        return stream_failure(StreamFailure::Invalid, "invalid VDJ stream path");
    }
    if (bearer_token.empty()) {
        return stream_failure(StreamFailure::Unauthorized, "VDJ access token is empty");
    }

    HttpRequest request{
        .method = "POST",
        .url = allowed_origin_ + "/api/auth/media-access",
        .allowed_origin = allowed_origin_,
        .headers = {
            {"Accept", "application/json"},
            {"Authorization", "Bearer " + std::string(bearer_token)},
            {"Content-Type", "application/json"},
        },
        .body = json::Value{
            {"targets", json::Value::array({{
                {"audience", "stream"},
                {"path", std::string(path)},
            }})},
        }.dump(),
        .timeout = timeout,
        .cancellation = cancellation,
    };

    const auto response = http_.request(request);
    if (const auto* error = std::get_if<HttpError>(&response)) {
        return stream_failure(*error);
    }

    const auto parsed = json::parse_object(std::get<HttpResponse>(response).body);
    const auto* tickets = parsed.ok() ? json::member(*parsed.value, "tickets") : nullptr;
    std::optional<std::string> ticket;
    if (tickets != nullptr && tickets->is_array()) {
        for (const auto& item : *tickets) {
            std::string audience;
            std::string returned_path;
            std::string value;
            if (json::required_string(item, "audience", audience) &&
                json::required_string(item, "path", returned_path) &&
                json::required_string(item, "ticket", value) &&
                audience == "stream" && returned_path == path) {
                ticket = std::move(value);
                break;
            }
        }
    }
    if (!ticket.has_value()) {
        return stream_failure(
            StreamFailure::Invalid,
            "media access response did not contain the requested stream ticket"
        );
    }

    return StreamResolution{
        .url = allowed_origin_ + std::string(path) + "?media_ticket=" +
            encode_query_value(*ticket),
    };
}

} // namespace crate::vdj
