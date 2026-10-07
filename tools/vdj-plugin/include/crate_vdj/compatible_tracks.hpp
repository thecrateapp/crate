#pragma once

#include "crate_vdj/credential_store.hpp"
#include "crate_vdj/http_client.hpp"
#include "crate_vdj/mix_profile.hpp"
#include "crate_vdj/models.hpp"

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace crate::vdj {

struct CompatibilityScoreBreakdown {
    int planner_version = 0;
    double overall = 0;
    double signal_confidence = 0;
    double tempo = 0;
    double harmonic = 0;
    std::string harmonic_relationship;
    double energy = 0;
    double danceability = 0;
    double valence = 0;
    double bliss = 0;
    double genre = 0;
};

struct CompatibleTrack {
    int track_id = 0;
    std::string track_entity_uid;
    std::string title;
    std::string artist;
    std::string album;
    double score = 0;
    double confidence = 0;
    CompatibilityScoreBreakdown score_breakdown;
    std::vector<std::string> fallback_reasons;
};

struct CompatibleTracks {
    std::string seed_track_entity_uid;
    std::string scope;
    std::string planner_version;
    std::vector<CompatibleTrack> items;
    std::optional<std::string> fallback_reason;
};

ParseResult<CompatibleTracks> parse_compatible_tracks_json(
    std::string_view json
);

SearchTrack compatible_track_as_search_track(const CompatibleTrack& track);

std::string compatible_track_comment(const CompatibleTrack& track);

class CompatibleTracksClient final {
public:
    CompatibleTracksClient(
        HttpClient& http,
        CredentialStore& credentials,
        std::string allowed_origin
    );

    ParseResult<CompatibleTracks> fetch(
        std::string_view seed_entity_uid,
        const CancellationToken& cancellation
    );

private:
    HttpClient& http_;
    CredentialStore& credentials_;
    std::string allowed_origin_;
};

} // namespace crate::vdj
