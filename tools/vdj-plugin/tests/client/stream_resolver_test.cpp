#include "crate_vdj/stream_resolver.hpp"

#include "../support/check.hpp"
#include <chrono>
#include <optional>
#include <string>
#include <thread>
#include <vector>

using namespace crate::vdj;
using namespace std::chrono_literals;

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
    std::optional<HttpError> playback_error;
    std::optional<HttpError> ticket_error;
    std::chrono::milliseconds playback_delay{0};
    std::chrono::milliseconds ticket_delay{0};

    HttpResult request(const HttpRequest& request) override
    {
        requests.push_back(request);
        const bool playback = request.url.ends_with("/playback");
        const auto delay = playback ? playback_delay : ticket_delay;
        if (delay > request.timeout) {
            std::this_thread::sleep_for(request.timeout);
            return HttpError{.code = HttpErrorCode::Timeout, .status_code = 0, .message = "timed out"};
        }
        std::this_thread::sleep_for(delay);
        const auto& error = playback ? playback_error : ticket_error;
        if (error.has_value()) {
            return *error;
        }
        return HttpResponse{.status_code = 200, .body = playback ? playback_body : ticket_body};
    }
};

HttpError http_status(int status)
{
    return HttpError{.code = HttpErrorCode::HttpStatus, .status_code = status, .message = "HTTP " + std::to_string(status)};
}

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

void expect_rejected_playback(std::string body, StreamFailure failure = StreamFailure::Invalid)
{
    FakeHttpClient http;
    http.playback_body = std::move(body);
    MemoryCredentialStore credentials;
    StreamResolver resolver(http, credentials, "https://api.dev.lespedants.org");

    const auto result = resolver.resolve("track-1", CancellationToken{});

    CRATE_CHECK(!result.ok());
    CRATE_CHECK(result.failure == failure);
    CRATE_CHECK(http.requests.size() == 1);
}

StreamFailure failure_for(FakeHttpClient& http)
{
    MemoryCredentialStore credentials;
    StreamResolver resolver(http, credentials, "https://api.dev.lespedants.org");
    return resolver.resolve("track-1", CancellationToken{}).failure;
}

void http_failures_are_classified_for_the_dj()
{
    FakeHttpClient unauthorized;
    unauthorized.playback_error = http_status(401);
    CRATE_CHECK(failure_for(unauthorized) == StreamFailure::Unauthorized);

    FakeHttpClient missing;
    missing.playback_error = http_status(404);
    CRATE_CHECK(failure_for(missing) == StreamFailure::NotFound);

    FakeHttpClient broken;
    broken.playback_error = http_status(502);
    CRATE_CHECK(failure_for(broken) == StreamFailure::Unreachable);

    FakeHttpClient offline;
    offline.playback_error = HttpError{.code = HttpErrorCode::Network, .status_code = 0, .message = "offline"};
    CRATE_CHECK(failure_for(offline) == StreamFailure::Unreachable);

    FakeHttpClient revoked_ticket;
    revoked_ticket.ticket_error = http_status(401);
    CRATE_CHECK(failure_for(revoked_ticket) == StreamFailure::Unauthorized);
}

void a_slow_server_fails_within_the_budget()
{
    FakeHttpClient http;
    http.playback_delay = 2s;
    MemoryCredentialStore credentials;
    StreamResolver resolver(http, credentials, "https://api.dev.lespedants.org", 200ms);

    const auto started = std::chrono::steady_clock::now();
    const auto result = resolver.resolve("track-1", CancellationToken{});
    const auto elapsed = std::chrono::steady_clock::now() - started;

    CRATE_CHECK(result.failure == StreamFailure::TimedOut);
    CRATE_CHECK(elapsed < 500ms);
}

void the_ticket_request_gets_what_is_left_of_the_budget()
{
    FakeHttpClient http;
    http.playback_delay = 150ms;
    MemoryCredentialStore credentials;
    StreamResolver resolver(http, credentials, "https://api.dev.lespedants.org", 400ms);

    CRATE_CHECK(resolver.resolve("track-1", CancellationToken{}).ok());

    CRATE_CHECK(http.requests.size() == 2);
    CRATE_CHECK(http.requests[0].timeout <= 400ms);
    CRATE_CHECK(http.requests[1].timeout <= 250ms);
    CRATE_CHECK(http.requests[1].timeout > 0ms);
}

} // namespace

int main()
{
    FakeHttpClient http;
    MemoryCredentialStore credentials;
    StreamResolver resolver(http, credentials, "https://api.dev.lespedants.org");

    const auto result = resolver.resolve("track-1", CancellationToken{});

    CRATE_CHECK(result.ok());
    CRATE_CHECK(*result.url ==
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
    CRATE_CHECK(cancelled_result.failure == StreamFailure::Cancelled);

    expect_rejected_playback("{}");
    expect_rejected_playback("not json");
    expect_rejected_playback(replace(std::string(kPlayable), R"("entity_uid":"track-1")", R"("entity_uid":"track-2")"));
    expect_rejected_playback(replace(std::string(kPlayable), R"("content_origin":"local")", R"("content_origin":"remote")"));
    expect_rejected_playback(
        replace(std::string(kPlayable), R"("preparing":false)", R"("preparing":true)"),
        StreamFailure::NotReady
    );
    expect_rejected_playback(replace(std::string(kPlayable), R"("delivery":{"format":"flac"})", R"("delivery":{"format":null})"));

    FakeHttpClient missing_ticket;
    missing_ticket.ticket_body = R"json({"tickets":[{"audience":"artwork","path":"/api/vdj/tracks/by-entity/track-1/stream","ticket":"x"}],"ticket":"top-level-decoy","path":"/api/vdj/tracks/by-entity/track-1/stream"})json";
    StreamResolver decoy_resolver(missing_ticket, credentials, "https://api.dev.lespedants.org");
    CRATE_CHECK(!decoy_resolver.resolve("track-1", CancellationToken{}).ok());

    http_failures_are_classified_for_the_dj();
    a_slow_server_fails_within_the_budget();
    the_ticket_request_gets_what_is_left_of_the_budget();
}
