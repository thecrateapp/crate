#include "crate_vdj/stream_resolver.hpp"

#include "../support/check.hpp"
#include <string>
#include <vector>

using namespace crate::vdj;

namespace {

class FakeHttpClient final : public HttpClient {
public:
    std::vector<HttpRequest> requests;

    HttpResult request(const HttpRequest& request) override
    {
        requests.push_back(request);
        if (requests.size() == 1) {
            return HttpResponse{
                .status_code = 200,
                .body = R"json({"stream_url":"/api/tracks/by-entity/track-1/stream"})json",
            };
        }
        return HttpResponse{
            .status_code = 200,
            .body = R"json({"tickets":[{"audience":"stream","path":"/api/vdj/tracks/by-entity/track-1/stream","ticket":"opaque-ticket","expires_at":"2026-08-17T12:00:00Z"}]})json",
        };
    }
};

class MemoryCredentialStore final : public CredentialStore {
public:
    std::optional<std::string> load_token() override
    {
        return "crv_private-token";
    }

    void save_token(std::string) override {}
    void clear_token() override {}
};

} // namespace

int main()
{
    FakeHttpClient http;
    MemoryCredentialStore credentials;
    StreamResolver resolver(http, credentials, "https://api.dev.lespedants.org");

    const auto result = resolver.resolve("track-1", CancellationToken{});

    CRATE_CHECK(result.ok());
    CRATE_CHECK(*result.value ==
           "https://api.dev.lespedants.org/api/vdj/tracks/by-entity/track-1/stream?media_ticket=opaque-ticket");
    CRATE_CHECK(http.requests.size() == 2);
    CRATE_CHECK(http.requests[0].url ==
           "https://api.dev.lespedants.org/api/vdj/tracks/by-entity/track-1/playback");
    CRATE_CHECK(http.requests[1].method == "POST");
    CRATE_CHECK(http.requests[1].url ==
           "https://api.dev.lespedants.org/api/auth/media-access");
    CRATE_CHECK(http.requests[1].body.find("track-1") != std::string::npos);
    CRATE_CHECK(http.requests[1].body.find("crv_private-token") == std::string::npos);

    CancellationSource cancelled;
    cancelled.cancel();
    const auto cancelled_result = resolver.resolve("track-1", cancelled.token());
    CRATE_CHECK(!cancelled_result.ok());
    CRATE_CHECK(cancelled_result.error_code == ModelErrorCode::TransportError);
}
