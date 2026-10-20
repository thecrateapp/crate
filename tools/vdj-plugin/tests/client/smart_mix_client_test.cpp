#include "crate_vdj/mix_profile.hpp"
#include "crate_vdj/smart_mix_client.hpp"

#include "../support/check.hpp"
#include <optional>
#include <string>
#include <variant>

using namespace crate::vdj;

namespace {

constexpr std::string_view kValidProfileJson = R"json({
    "trackEntityUid": "550e8400-e29b-41d4-a716-446655440000",
    "profileVersion": 1,
    "profileRevision": "profile-sha",
    "analyzer": "crate-rust",
    "analyzerVersion": "smart-mix-v1",
    "sourceRevision": "source-sha",
    "durationMs": 245000,
    "quality": "full",
    "analyzedAt": "2026-07-28T00:00:00Z",
    "bpm": 128.1,
    "bpmConfidence": 0.94,
    "tempoStability": 0.97,
    "beatAnchorMs": 482,
    "downbeatAnchorMs": 482,
    "timeSignature": 4,
    "beatGridFormat": "delta-ms-v1",
    "key": "A",
    "scale": "minor",
    "camelot": "8A",
    "keyConfidence": 0.88,
    "introCueMs": 8000,
    "outroCueMs": 238000,
    "introLufs": -10.0,
    "outroLufs": -10.0,
    "truePeakDbfs": -1.0,
    "introEnergy": 0.7,
    "outroEnergy": 0.7,
    "introSpectralDensity": 0.5,
    "outroSpectralDensity": 0.5,
    "globalEnergy": 0.7,
    "danceability": 0.7,
    "valence": 0.5,
    "blissVectorRevision": "bliss-v1",
    "beatGridMs": [482, 951]
})json";

class FakeHttpClient final : public HttpClient {
public:
    HttpRequest request_seen;
    HttpResult response = HttpResponse{
        .status_code = 200,
        .body = std::string(kValidProfileJson),
    };

    HttpResult request(const HttpRequest& request) override
    {
        request_seen = request;
        return response;
    }
};

class MemoryCredentialStore final : public CredentialStore {
public:
    std::optional<std::string> load_token() override
    {
        return "crv_smart-mix-token";
    }

    bool save_token(std::string) override { return true; }
    bool clear_token() override { return true; }
};

std::string profile_json_with(std::string_view field, std::string_view value)
{
    std::string json(kValidProfileJson);
    const std::string marker = "\"" + std::string(field) + "\":";
    const std::size_t position = json.find(marker);
    CRATE_CHECK(position != std::string::npos);
    const std::size_t value_start = position + marker.size();
    const std::size_t value_end = json.find(',', value_start);
    CRATE_CHECK(value_end != std::string::npos);
    json.replace(value_start, value_end - value_start, value);
    return json;
}

} // namespace

int main()
{
    const auto parsed = parse_mix_profile_json(kValidProfileJson);
    CRATE_CHECK(parsed.ok());
    CRATE_CHECK(parsed.value->track_entity_uid ==
           "550e8400-e29b-41d4-a716-446655440000");
    CRATE_CHECK(parsed.value->profile_version == 1);
    CRATE_CHECK(parsed.value->quality == MixProfileQuality::Full);
    CRATE_CHECK(parsed.value->bpm.has_value());
    CRATE_CHECK(*parsed.value->bpm == 128.1);
    CRATE_CHECK(parsed.value->bpm_confidence.has_value());
    CRATE_CHECK(*parsed.value->bpm_confidence == 0.94);
    CRATE_CHECK(parsed.value->camelot == "8A");
    CRATE_CHECK(parsed.value->intro_energy.has_value());
    CRATE_CHECK(*parsed.value->intro_energy == 0.7);
    CRATE_CHECK(parsed.value->intro_cue_ms == 8000);
    CRATE_CHECK(parsed.value->beat_grid_format == "delta-ms-v1");

    const auto partial = parse_mix_profile_json(R"json({
        "trackEntityUid": "track-partial",
        "profileVersion": 1,
        "profileRevision": "partial-revision",
        "analyzer": "crate-rust",
        "analyzerVersion": "smart-mix-v1",
        "sourceRevision": "source-partial",
        "durationMs": 180000,
        "quality": "partial",
        "analyzedAt": "2026-07-28T00:00:00Z",
        "bpm": 98.0,
        "bpmConfidence": 0.2
    })json");
    CRATE_CHECK(partial.ok());
    CRATE_CHECK(partial.value->quality == MixProfileQuality::Partial);
    CRATE_CHECK(partial.value->bpm_confidence.has_value());
    CRATE_CHECK(*partial.value->bpm_confidence == 0.2);
    CRATE_CHECK(!partial.value->key.has_value());
    CRATE_CHECK(!partial.value->intro_cue_ms.has_value());

    const auto unsupported = parse_mix_profile_json(
        profile_json_with("profileVersion", "2")
    );
    CRATE_CHECK(!unsupported.ok());
    CRATE_CHECK(unsupported.error_code == ModelErrorCode::UnsupportedSchema);

    FakeHttpClient http;
    MemoryCredentialStore credentials;
    SmartMixClient client(http, credentials, "https://api.dev.lespedants.org");
    const auto fetched = client.fetch_summary(
        "550e8400-e29b-41d4-a716-446655440000",
        CancellationToken{}
    );
    CRATE_CHECK(fetched.ok());
    CRATE_CHECK(http.request_seen.url ==
           "https://api.dev.lespedants.org/api/tracks/by-entity/"
           "550e8400-e29b-41d4-a716-446655440000/mix-profile?detail=summary");
    CRATE_CHECK(http.request_seen.headers.size() == 2);
    CRATE_CHECK(http.request_seen.headers[1].second ==
           "Bearer crv_smart-mix-token");

    http.response = HttpError{
        .code = HttpErrorCode::HttpStatus,
        .status_code = 404,
        .message = "profile not found",
    };
    const auto unavailable = client.fetch_summary(
        "missing-track",
        CancellationToken{}
    );
    CRATE_CHECK(unavailable.ok());
    CRATE_CHECK(unavailable.value->quality == MixProfileQuality::Unavailable);
    CRATE_CHECK(unavailable.value->track_entity_uid == "missing-track");

    http.response = HttpResponse{
        .status_code = 200,
        .body = profile_json_with(
            "analyzerVersion",
            "\"smart-mix-audio-v2\""
        ),
    };
    const auto newer_analyzer = client.fetch_summary(
        "550e8400-e29b-41d4-a716-446655440000",
        CancellationToken{}
    );
    CRATE_CHECK(newer_analyzer.ok());
    CRATE_CHECK(newer_analyzer.value->analyzer_version == "smart-mix-audio-v2");

}
