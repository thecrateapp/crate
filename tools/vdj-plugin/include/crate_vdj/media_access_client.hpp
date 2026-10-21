#pragma once

#include "crate_vdj/http_client.hpp"
#include "crate_vdj/models.hpp"

#include <string>
#include <string_view>

namespace crate::vdj {

class MediaAccessClient final {
public:
    MediaAccessClient(HttpClient& http, std::string allowed_origin);

    ParseResult<std::string> issue_stream_url(
        std::string_view path,
        std::string_view bearer_token,
        const CancellationToken& cancellation
    );

private:
    HttpClient& http_;
    std::string allowed_origin_;
};

} // namespace crate::vdj
