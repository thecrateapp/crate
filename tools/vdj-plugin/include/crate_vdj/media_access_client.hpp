#pragma once

#include "crate_vdj/http_client.hpp"
#include "crate_vdj/models.hpp"

#include <chrono>
#include <optional>
#include <string>
#include <string_view>

namespace crate::vdj {

enum class StreamFailure {
    None,
    Cancelled,
    TimedOut,
    Unreachable,
    Unauthorized,
    NotFound,
    NotReady,
    Invalid,
};

struct StreamResolution {
    std::optional<std::string> url;
    StreamFailure failure = StreamFailure::None;
    std::string detail;

    bool ok() const
    {
        return url.has_value();
    }
};

StreamResolution stream_failure(StreamFailure failure, std::string detail);
StreamResolution stream_failure(const HttpError& error);

class MediaAccessClient final {
public:
    MediaAccessClient(HttpClient& http, std::string allowed_origin);

    StreamResolution issue_stream_url(
        std::string_view path,
        std::string_view bearer_token,
        const CancellationToken& cancellation,
        std::chrono::milliseconds timeout
    );

private:
    HttpClient& http_;
    std::string allowed_origin_;
};

} // namespace crate::vdj
