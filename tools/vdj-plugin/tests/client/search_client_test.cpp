#include "crate_vdj/search_client.hpp"

#include "../support/check.hpp"
#include <chrono>
#include <filesystem>
#include <string>
#include <variant>

using namespace crate::vdj;

namespace {

class FakeHttpClient final : public HttpClient {
public:
    HttpRequest request_seen;
    int request_count = 0;
    bool fail_requests = false;
    HttpError failure{
        .code = HttpErrorCode::Network,
        .status_code = 0,
        .message = "test network failure",
    };

    HttpResult request(const HttpRequest& request) override
    {
        ++request_count;
        request_seen = request;
        if (fail_requests) {
            return failure;
        }
        return HttpResponse{
            .status_code = 200,
            .body = R"json({
                "artists": [],
                "albums": [],
                "tracks": [{
                    "entity_uid": "track-1",
                    "title": "Noah",
                    "artist": "Birds In Row",
                    "album": "Gris Klein",
                    "duration": 193.5
                }]
            })json",
        };
    }
};

class MemoryCredentialStore final : public CredentialStore {
public:
    std::string token = "crv_search-token";

    std::optional<std::string> load_token() override
    {
        return token;
    }

    bool save_token(std::string) override { return true; }
    bool clear_token() override { return true; }
};

} // namespace

int main()
{
    FakeHttpClient http;
    MemoryCredentialStore credentials;
    SearchClient client(http, credentials, "https://api.dev.lespedants.org");

    const auto result = client.search("birds in row", CancellationToken{});
    CRATE_CHECK(result.ok());
    CRATE_CHECK(result.value->tracks.size() == 1);
    CRATE_CHECK(result.value->tracks[0].entity_uid == "track-1");
    CRATE_CHECK(http.request_seen.url ==
           "https://api.dev.lespedants.org/api/search?q=birds%20in%20row&scope=local&limit=50");
    CRATE_CHECK(http.request_seen.allowed_origin == "https://api.dev.lespedants.org");
    CRATE_CHECK(http.request_seen.headers.size() == 2);
    CRATE_CHECK(http.request_seen.headers[0].first == "Accept");
    CRATE_CHECK(http.request_seen.headers[1].first == "Authorization");
    CRATE_CHECK(http.request_seen.headers[1].second == "Bearer crv_search-token");

    const auto invalid = client.search("", CancellationToken{});
    CRATE_CHECK(!invalid.ok());
    CRATE_CHECK(invalid.error_code == ModelErrorCode::InvalidField);

    MetadataCacheStore cache(":memory:");
    SearchClient cached_client(
        http,
        credentials,
        "https://api.dev.lespedants.org",
        &cache
    );
    const auto first_cached = cached_client.search("cached", CancellationToken{});
    CRATE_CHECK(first_cached.ok());
    CRATE_CHECK(http.request_count == 2);
    const auto second_cached = cached_client.search("cached", CancellationToken{});
    CRATE_CHECK(second_cached.ok());
    CRATE_CHECK(second_cached.value->tracks[0].entity_uid == "track-1");
    CRATE_CHECK(http.request_count == 2);

    credentials.token = "crv_other-user-token";
    const auto other_account = cached_client.search("cached", CancellationToken{});
    CRATE_CHECK(other_account.ok());
    CRATE_CHECK(http.request_count == 3);
    credentials.token = "crv_search-token";

    MetadataCacheStore stale_cache(
        ":memory:",
        {.fresh_ttl_seconds = 0, .stale_ttl_seconds = 3600, .max_entries = 8}
    );
    SearchClient stale_client(
        http,
        credentials,
        "https://api.dev.lespedants.org",
        &stale_cache
    );
    const auto seed = client.search("stale", CancellationToken{});
    CRATE_CHECK(seed.ok());
    CRATE_CHECK(stale_cache.put_search(
        {.origin = "https://api.dev.lespedants.org",
         .account_key = metadata_cache_account_key(credentials.token)},
        "stale",
        *seed.value,
        std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count() - 60
    ));
    http.fail_requests = true;
    const auto fallback = stale_client.search("stale", CancellationToken{});
    CRATE_CHECK(fallback.ok());
    CRATE_CHECK(fallback.value->tracks[0].entity_uid == "track-1");

    const auto reject_stale = [&](HttpError error) {
        http.failure = std::move(error);
        const int requests_before = http.request_count;
        const auto result = stale_client.search("stale", CancellationToken{});
        CRATE_CHECK(http.request_count == requests_before + 1);
        CRATE_CHECK(!result.ok());
    };
    reject_stale({.code = HttpErrorCode::HttpStatus, .status_code = 401, .message = "unauthorized"});
    reject_stale({.code = HttpErrorCode::HttpStatus, .status_code = 403, .message = "forbidden"});
    reject_stale({.code = HttpErrorCode::Cancelled, .status_code = 0, .message = "cancelled"});
    reject_stale({.code = HttpErrorCode::InvalidResponse, .status_code = 200, .message = "too large"});

    http.failure = {.code = HttpErrorCode::HttpStatus, .status_code = 503, .message = "unavailable"};
    CRATE_CHECK((stale_client.search("stale", CancellationToken{})).ok());
    http.failure = {.code = HttpErrorCode::Timeout, .status_code = 0, .message = "timeout"};
    CRATE_CHECK((stale_client.search("stale", CancellationToken{})).ok());
}
