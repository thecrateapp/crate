#pragma once

#include "crate_vdj/http_client.hpp"

#include <map>
#include <string>
#include <vector>

namespace crate::vdj::testing {

inline constexpr const char* kOrigin = "https://api.example.org";

inline std::string me_json(
    const std::string& scopes =
        R"(["vdj.catalog.read","vdj.media.read","vdj.smart_mix.read","vdj.play_events.write"])"
)
{
    return R"({"id":7,"email":"dj@example.org","name":"DJ","username":"dj",)"
           R"("role":"user","auth_type":"access_token","scopes":)" +
        scopes + R"(,"capabilities":[]})";
}

inline std::string capabilities_json(
    bool vdj_available = true,
    const std::string& contract = "2026-08",
    bool token_automation = false,
    const std::string& token_scopes =
        R"(["vdj.catalog.read","vdj.media.read","vdj.smart_mix.read","vdj.play_events.write"])"
)
{
    return std::string(R"({"smart_mix":{"available":true,"planner_version":"smart-mix-v2",)") +
        R"("android_native_crossfade":false,"android_beatmatch":false},"vdj":{"available":)" +
        (vdj_available ? "true" : "false") +
        R"(,"min_plugin_version":"1.0.0","max_plugin_version":"1.x","contract_version":")" +
        contract +
        R"(","profile_schema_version":1,"planner_version":"smart-mix-v2","online_source":)" +
        (vdj_available ? "true" : "false") + R"(,"smart_mix_assistant":)" +
        (vdj_available ? "true" : "false") + R"(,"automation":)" +
        (token_automation ? "true" : "false") + R"(},"access_token":{"scopes":)" + token_scopes +
        R"(,"automation":)" + (token_automation ? "true" : "false") + "}}";
}

class ScriptedHttpClient final : public HttpClient {
public:
    std::map<std::string, HttpResult> responses;
    std::vector<HttpRequest> requests;

    HttpResult request(const HttpRequest& request) override
    {
        requests.push_back(request);
        const auto found = responses.find(request.url);
        if (found == responses.end()) {
            return HttpError{
                .code = HttpErrorCode::Network,
                .status_code = 0,
                .message = "no scripted response",
            };
        }
        return found->second;
    }

    void serve(const std::string& path, std::string body)
    {
        responses[std::string(kOrigin) + path] = HttpResponse{
            .status_code = 200,
            .body = std::move(body),
        };
    }

    void fail(const std::string& path, int status)
    {
        responses[std::string(kOrigin) + path] = HttpError{
            .code = HttpErrorCode::HttpStatus,
            .status_code = status,
            .message = "HTTP " + std::to_string(status),
        };
    }

    void serve_connected(bool automation = false)
    {
        serve("/api/auth/me", me_json());
        serve("/api/capabilities", capabilities_json(true, "2026-08", automation));
    }
};

} // namespace crate::vdj::testing
