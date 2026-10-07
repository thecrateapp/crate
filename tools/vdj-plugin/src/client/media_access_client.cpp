#include "crate_vdj/media_access_client.hpp"

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

std::optional<std::string> string_field(
    std::string_view json,
    std::string_view name
)
{
    const std::string marker = "\"" + std::string(name) + "\"";
    std::size_t position = json.find(marker);
    while (position != std::string_view::npos) {
        position += marker.size();
        while (position < json.size() &&
               std::isspace(static_cast<unsigned char>(json[position]))) {
            ++position;
        }
        if (position >= json.size() || json[position++] != ':') {
            position = json.find(marker, position);
            continue;
        }
        while (position < json.size() &&
               std::isspace(static_cast<unsigned char>(json[position]))) {
            ++position;
        }
        if (position >= json.size() || json[position++] != '"') {
            return std::nullopt;
        }

        std::string value;
        while (position < json.size()) {
            const char character = json[position++];
            if (character == '"') {
                return value;
            }
            if (character != '\\' || position >= json.size()) {
                if (character == '\\') {
                    return std::nullopt;
                }
                value.push_back(character);
                continue;
            }
            const char escaped = json[position++];
            switch (escaped) {
            case '"':
            case '\\':
            case '/':
                value.push_back(escaped);
                break;
            case 'b':
                value.push_back('\b');
                break;
            case 'f':
                value.push_back('\f');
                break;
            case 'n':
                value.push_back('\n');
                break;
            case 'r':
                value.push_back('\r');
                break;
            case 't':
                value.push_back('\t');
                break;
            default:
                return std::nullopt;
            }
        }
        return std::nullopt;
    }
    return std::nullopt;
}

std::string json_escape(std::string_view value)
{
    std::string escaped;
    escaped.reserve(value.size());
    for (const char character : value) {
        if (character == '\\' || character == '"') {
            escaped.push_back('\\');
        }
        escaped.push_back(character);
    }
    return escaped;
}

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

ParseResult<std::string> MediaAccessClient::issue_stream_url(
    std::string_view path,
    std::string_view bearer_token,
    const CancellationToken& cancellation
)
{
    if (cancellation.cancelled()) {
        return failure(ModelErrorCode::TransportError, "request cancelled");
    }
    if (!is_stream_path(path)) {
        return failure(ModelErrorCode::InvalidField, "invalid VDJ stream path");
    }
    if (bearer_token.empty()) {
        return failure(ModelErrorCode::InvalidField, "VDJ access token is empty");
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
        .body = "{\"targets\":[{\"audience\":\"stream\",\"path\":\"" +
            json_escape(path) + "\"}]}",
        .cancellation = cancellation,
    };

    const auto response = http_.request(request);
    if (const auto* error = std::get_if<HttpError>(&response)) {
        return failure(ModelErrorCode::TransportError, error->message);
    }

    const auto& http_response = std::get<HttpResponse>(response);
    const auto ticket = string_field(http_response.body, "ticket");
    const auto returned_path = string_field(http_response.body, "path");
    if (!ticket.has_value() || ticket->empty() ||
        !returned_path.has_value() || *returned_path != path) {
        return failure(
            ModelErrorCode::InvalidResponse,
            "media access response did not contain the requested stream ticket"
        );
    }

    return ParseResult<std::string>{
        .value = allowed_origin_ + std::string(path) + "?media_ticket=" +
            encode_query_value(*ticket),
        .error_code = ModelErrorCode::InvalidJson,
        .error = {},
    };
}

} // namespace crate::vdj
