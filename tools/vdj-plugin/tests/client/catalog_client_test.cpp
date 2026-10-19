#include "crate_vdj/catalog_client.hpp"

#include "../support/check.hpp"
#include <chrono>
#include <optional>
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
        if (request.url.ends_with("/api/vdj/catalog/folders")) {
            return HttpResponse{
                .status_code = 200,
                .body = R"json({
                    "folders": [
                        {"id": "crate:playlists", "name": "Playlists"},
                        {"id": "crate:genres", "name": "Genres"}
                    ],
                    "tracks": [],
                    "next_cursor": null
                })json",
            };
        }
        return HttpResponse{
            .status_code = 200,
            .body = R"json({
                "folders": [],
                "tracks": [{
                    "entity_uid": "track-1",
                    "title": "Noah",
                    "artist": "Birds In Row",
                    "album": "Gris Klein",
                    "duration": 193.5,
                    "year": "2022",
                    "genre": "post-hardcore",
                    "has_cover": true,
                    "cover_url": "/api/vdj/albums/3/cover?size=512"
                }],
                "next_cursor": "cursor-1"
            })json",
        };
    }
};

class MemoryCredentialStore final : public CredentialStore {
public:
    std::optional<std::string> load_token() override
    {
        return "crv_catalog-token";
    }

    bool save_token(std::string) override { return true; }
    bool clear_token() override { return true; }
};

} // namespace

int main()
{
    FakeHttpClient http;
    MemoryCredentialStore credentials;
    CatalogClient client(http, credentials, "https://api.dev.lespedants.org");

    const auto folders = client.list_folders(CancellationToken{});
    CRATE_CHECK(folders.ok());
    CRATE_CHECK(folders.value->folders.size() == 2);
    CRATE_CHECK(folders.value->folders[0].id == "crate:playlists");
    CRATE_CHECK(folders.value->folders[1].name == "Genres");
    CRATE_CHECK(http.request_seen.headers[1].second == "Bearer crv_catalog-token");

    const auto page = client.get_folder(
        "crate:playlists",
        "cursor-0",
        CancellationToken{}
    );
    CRATE_CHECK(page.ok());
    CRATE_CHECK(page.value->tracks.size() == 1);
    CRATE_CHECK(page.value->tracks[0].entity_uid == "track-1");
    CRATE_CHECK(page.value->next_cursor == "cursor-1");
    CRATE_CHECK(http.request_seen.url ==
           "https://api.dev.lespedants.org/api/vdj/catalog/folders/crate%3Aplaylists?cursor=cursor-0&limit=500");

    MetadataCacheStore cache(":memory:");
    CatalogClient cached_client(
        http,
        credentials,
        "https://api.dev.lespedants.org",
        &cache
    );
    const auto first_cached = cached_client.list_folders(CancellationToken{});
    CRATE_CHECK(first_cached.ok());
    const int requests_after_first_cached = http.request_count;
    const auto second_cached = cached_client.list_folders(CancellationToken{});
    CRATE_CHECK(second_cached.ok());
    CRATE_CHECK(http.request_count == requests_after_first_cached);

    MetadataCacheStore stale_cache(
        ":memory:",
        {.fresh_ttl_seconds = 0, .stale_ttl_seconds = 3600, .max_entries = 8}
    );
    CatalogClient stale_client(
        http,
        credentials,
        "https://api.dev.lespedants.org",
        &stale_cache
    );
    http.fail_requests = false;
    const auto seed = client.get_folder("crate:playlists", "cursor-stale", CancellationToken{});
    CRATE_CHECK(seed.ok());
    CRATE_CHECK(stale_cache.put_catalog(
        {.origin = "https://api.dev.lespedants.org",
         .account_key = metadata_cache_account_key("crv_catalog-token")},
        "folder:crate:playlists:cursor:cursor-stale",
        *seed.value,
        std::chrono::duration_cast<std::chrono::seconds>(
            std::chrono::system_clock::now().time_since_epoch()
        ).count() - 60
    ));
    http.fail_requests = true;
    const auto fallback = stale_client.get_folder(
        "crate:playlists",
        "cursor-stale",
        CancellationToken{}
    );
    CRATE_CHECK(fallback.ok());
    CRATE_CHECK(fallback.value->tracks[0].entity_uid == "track-1");

    const auto reject_stale = [&](HttpError error) {
        http.failure = std::move(error);
        const int requests_before = http.request_count;
        const auto result = stale_client.get_folder(
            "crate:playlists",
            "cursor-stale",
            CancellationToken{}
        );
        CRATE_CHECK(http.request_count == requests_before + 1);
        CRATE_CHECK(!result.ok());
    };
    reject_stale({.code = HttpErrorCode::HttpStatus, .status_code = 401, .message = "unauthorized"});
    reject_stale({.code = HttpErrorCode::HttpStatus, .status_code = 403, .message = "forbidden"});
    reject_stale({.code = HttpErrorCode::Cancelled, .status_code = 0, .message = "cancelled"});
    reject_stale({.code = HttpErrorCode::InvalidResponse, .status_code = 200, .message = "too large"});

    http.failure = {.code = HttpErrorCode::HttpStatus, .status_code = 503, .message = "unavailable"};
    CRATE_CHECK((stale_client.get_folder(
        "crate:playlists",
        "cursor-stale",
        CancellationToken{}
    )).ok());
    http.failure = {.code = HttpErrorCode::Timeout, .status_code = 0, .message = "timeout"};
    CRATE_CHECK((stale_client.get_folder(
        "crate:playlists",
        "cursor-stale",
        CancellationToken{}
    )).ok());
}
