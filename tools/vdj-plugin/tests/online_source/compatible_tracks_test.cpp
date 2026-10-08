#include "crate_vdj/compatible_tracks.hpp"

#include <cassert>
#include <optional>
#include <string>
#include <variant>

using namespace crate::vdj;

namespace {

constexpr std::string_view kCompatibleTracksJson = R"json({
    "seedTrackEntityUid": "seed-track",
    "scope": "local",
    "plannerVersion": "smart-mix-v2",
    "items": [
        {
            "trackId": 42,
            "trackEntityUid": "compatible-first",
            "title": "First Track",
            "artist": "Artist One",
            "album": "Album One",
            "score": 0.91,
            "confidence": 0.88,
            "scoreBreakdown": {
                "plannerVersion": 2,
                "overall": 0.91,
                "signalConfidence": 0.88,
                "tempo": 1.0,
                "harmonic": 0.9,
                "harmonicRelationship": "adjacent",
                "energy": 0.8,
                "danceability": 0.7,
                "valence": 0.6,
                "bliss": 0.5,
                "genre": 0.4
            },
            "fallbackReasons": []
        },
        {
            "trackId": 43,
            "trackEntityUid": "compatible-second",
            "title": "Second Track",
            "artist": "Artist Two",
            "album": "Album Two",
            "score": 0.42,
            "confidence": 0.31,
            "scoreBreakdown": {
                "plannerVersion": 2,
                "overall": 0.42,
                "signalConfidence": 0.31,
                "tempo": 0.5,
                "harmonic": 0.4,
                "harmonicRelationship": "unknown",
                "energy": 0.3,
                "danceability": 0.2,
                "valence": 0.1,
                "bliss": 0.0,
                "genre": 0.0
            },
            "fallbackReasons": ["low_confidence"]
        }
    ]
})json";

class FakeHttpClient final : public HttpClient {
public:
    HttpRequest request_seen;
    int request_count = 0;
    HttpResult response = HttpResponse{
        .status_code = 200,
        .body = std::string(kCompatibleTracksJson),
    };

    HttpResult request(const HttpRequest& request) override
    {
        ++request_count;
        request_seen = request;
        if (request.cancellation.cancelled()) {
            return HttpError{
                .code = HttpErrorCode::Cancelled,
                .status_code = 0,
                .message = "cancelled",
            };
        }
        return response;
    }
};

class MemoryCredentialStore final : public CredentialStore {
public:
    std::optional<std::string> load_token() override
    {
        return "crv_compatible-token";
    }

    void save_token(std::string) override {}
    void clear_token() override {}
};

} // namespace

int main()
{
    const auto parsed = parse_compatible_tracks_json(kCompatibleTracksJson);
    assert(parsed.ok());
    assert(parsed.value->seed_track_entity_uid == "seed-track");
    assert(parsed.value->scope == "local");
    assert(parsed.value->planner_version == "smart-mix-v2");
    assert(parsed.value->items.size() == 2);
    assert(parsed.value->items[0].track_entity_uid == "compatible-first");
    assert(parsed.value->items[0].score_breakdown.planner_version == 2);
    assert(parsed.value->items[0].score_breakdown.harmonic_relationship ==
           "adjacent");
    assert(parsed.value->items[1].fallback_reasons[0] == "low_confidence");

    const auto mapped = compatible_track_as_search_track(
        parsed.value->items[0]
    );
    assert(mapped.entity_uid == "compatible-first");
    assert(mapped.title == "First Track");
    assert(mapped.artist == "Artist One");
    assert(mapped.album == "Album One");
    const auto comment = compatible_track_comment(parsed.value->items[0]);
    assert(comment.find("score=0.91") != std::string::npos);
    assert(comment.find("harmonic=adjacent") != std::string::npos);
    assert(comment.find("tempo=1.00") != std::string::npos);

    FakeHttpClient http;
    MemoryCredentialStore credentials;
    CompatibleTracksClient client(
        http,
        credentials,
        "https://api.dev.lespedants.org"
    );
    const auto fetched = client.fetch("seed-track", CancellationToken{});
    assert(fetched.ok());
    assert(http.request_seen.url ==
           "https://api.dev.lespedants.org/api/tracks/by-entity/seed-track/"
           "compatible?scope=local&limit=20&planner_version=smart-mix-v2");
    assert(http.request_seen.headers.size() == 2);
    assert(http.request_seen.headers[1].second ==
           "Bearer crv_compatible-token");

    http.response = HttpError{
        .code = HttpErrorCode::HttpStatus,
        .status_code = 404,
        .message = "profile not found",
    };
    const auto missing_profile = client.fetch(
        "missing-seed",
        CancellationToken{}
    );
    assert(missing_profile.ok());
    assert(missing_profile.value->items.empty());
    assert(missing_profile.value->fallback_reason == "missing_profile");

    CancellationSource stale_request;
    stale_request.cancel();
    const auto cancelled = client.fetch("stale-seed", stale_request.token());
    assert(!cancelled.ok());
    assert(cancelled.error_code == ModelErrorCode::TransportError);

    return 0;
}
