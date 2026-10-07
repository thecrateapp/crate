#include "crate_vdj/search_client.hpp"

#include <cassert>
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

    HttpResult request(const HttpRequest& request) override
    {
        ++request_count;
        request_seen = request;
        if (fail_requests) {
            return HttpError{.message = "test network failure"};
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

    void save_token(std::string) override {}
    void clear_token() override {}
};

} // namespace

int main()
{
    FakeHttpClient http;
    MemoryCredentialStore credentials;
    SearchClient client(http, credentials, "https://api.dev.lespedants.org");

    const auto result = client.search("birds in row", CancellationToken{});
    assert(result.ok());
    assert(result.value->tracks.size() == 1);
    assert(result.value->tracks[0].entity_uid == "track-1");
    assert(http.request_seen.url ==
           "https://api.dev.lespedants.org/api/search?q=birds%20in%20row&scope=local&limit=50");
    assert(http.request_seen.allowed_origin == "https://api.dev.lespedants.org");
    assert(http.request_seen.headers.size() == 2);
    assert(http.request_seen.headers[0].first == "Accept");
    assert(http.request_seen.headers[1].first == "Authorization");
    assert(http.request_seen.headers[1].second == "Bearer crv_search-token");

    const auto invalid = client.search("", CancellationToken{});
    assert(!invalid.ok());
    assert(invalid.error_code == ModelErrorCode::InvalidField);

    MetadataCacheStore cache(":memory:");
    SearchClient cached_client(
        http,
        credentials,
        "https://api.dev.lespedants.org",
        &cache
    );
    const auto first_cached = cached_client.search("cached", CancellationToken{});
    assert(first_cached.ok());
    assert(http.request_count == 2);
    const auto second_cached = cached_client.search("cached", CancellationToken{});
    assert(second_cached.ok());
    assert(second_cached.value->tracks[0].entity_uid == "track-1");
    assert(http.request_count == 2);

    credentials.token = "crv_other-user-token";
    const auto other_account = cached_client.search("cached", CancellationToken{});
    assert(other_account.ok());
    assert(http.request_count == 3);
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
    const auto initial_stale = stale_client.search("stale", CancellationToken{});
    assert(initial_stale.ok());
    http.fail_requests = true;
    const auto fallback = stale_client.search("stale", CancellationToken{});
    assert(fallback.ok());
    assert(fallback.value->tracks[0].entity_uid == "track-1");
}
