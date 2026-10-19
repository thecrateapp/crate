#include "crate_vdj/stream_resolver.hpp"

#include "../support/check.hpp"
#include <string>
#include <vector>

using namespace crate::vdj;

namespace {

constexpr std::string_view kPlayable =
    R"json({"stream_url":"/api/tracks/by-entity/track-1/stream","requested_policy":"original","effective_policy":"original","source":{"format":"flac"},"delivery":{"format":"flac"},"preparing":false,"playback_session":"s","content_origin":"local","entity_uid":"track-1"})json";

constexpr std::string_view kTicket =
    R"json({"tickets":[{"audience":"stream","path":"/api/vdj/tracks/by-entity/other/stream","ticket":"wrong-ticket"},{"audience":"stream","path":"/api/vdj/tracks/by-entity/track-1/stream","ticket":"opaque-ticket","expires_at":"2026-08-17T12:00:00Z"}]})json";

class FakeHttpClient final : public HttpClient {
public:
    std::vector<HttpRequest> requests;
    std::string playback_body = std::string(kPlayable);
    std::string ticket_body = std::string(kTicket);

    HttpResult request(const HttpRequest& request) override
    {
        requests.push_back(request);
        if (request.url.ends_with("/playback")) {
            return HttpResponse{.status_code = 200, .body = playback_body};
        }
        return HttpResponse{.status_code = 200, .body = ticket_body};
    }
};

class MemoryCredentialStore final : public CredentialStore {
public:
    std::optional<std::string> load_token() override
    {
        return "crv_private-token";
    }

    bool save_token(std::string) override { return true; }
    bool clear_token() override { return true; }
};

std::string replace(std::string text, std::string_view from, std::string_view to)
{
    const auto position = text.find(from);
    CRATE_CHECK(position != std::string::npos);
    text.replace(position, from.size(), to);
    return text;
}

void expect_rejected_playback(std::string body)
{
    FakeHttpClient http;
    http.playback_body = std::move(body);
    MemoryCredentialStore credentials;
    StreamResolver resolver(http, credentials, "https://api.dev.lespedants.org");

    const auto result = resolver.resolve("track-1", CancellationToken{});

    CRATE_CHECK(!result.ok());
    CRATE_CHECK(result.error_code == ModelErrorCode::InvalidResponse);
    CRATE_CHECK(http.requests.size() == 1);
}

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

    expect_rejected_playback("{}");
    expect_rejected_playback("not json");
    expect_rejected_playback(replace(std::string(kPlayable), R"("entity_uid":"track-1")", R"("entity_uid":"track-2")"));
    expect_rejected_playback(replace(std::string(kPlayable), R"("content_origin":"local")", R"("content_origin":"remote")"));
    expect_rejected_playback(replace(std::string(kPlayable), R"("preparing":false)", R"("preparing":true)"));
    expect_rejected_playback(replace(std::string(kPlayable), R"("delivery":{"format":"flac"})", R"("delivery":{"format":null})"));

    FakeHttpClient missing_ticket;
    missing_ticket.ticket_body = R"json({"tickets":[{"audience":"artwork","path":"/api/vdj/tracks/by-entity/track-1/stream","ticket":"x"}],"ticket":"top-level-decoy","path":"/api/vdj/tracks/by-entity/track-1/stream"})json";
    StreamResolver decoy_resolver(missing_ticket, credentials, "https://api.dev.lespedants.org");
    CRATE_CHECK(!decoy_resolver.resolve("track-1", CancellationToken{}).ok());
}
