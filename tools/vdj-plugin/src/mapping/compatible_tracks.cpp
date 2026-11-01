#include "crate_vdj/compatible_tracks.hpp"

#include "crate_vdj/json_mapping.hpp"

#include <charconv>
#include <limits>

namespace crate::vdj {
namespace {

bool unit_number(const json::Value& object, std::string_view name, double& output)
{
    return json::required_number(object, name, output) && output >= 0.0 && output <= 1.0;
}

bool required_int(
    const json::Value& object,
    std::string_view name,
    int& output,
    std::int64_t minimum
)
{
    std::int64_t value = 0;
    if (!json::required_integer(
            object,
            name,
            value,
            minimum,
            std::numeric_limits<int>::max()
        )) {
        return false;
    }
    output = static_cast<int>(value);
    return true;
}

bool parse_breakdown(const json::Value& value, CompatibilityScoreBreakdown& breakdown)
{
    return value.is_object() &&
        required_int(value, "plannerVersion", breakdown.planner_version, 1) &&
        breakdown.planner_version == kSmartMixPlannerPolicyVersion &&
        unit_number(value, "overall", breakdown.overall) &&
        unit_number(value, "signalConfidence", breakdown.signal_confidence) &&
        unit_number(value, "tempo", breakdown.tempo) &&
        unit_number(value, "harmonic", breakdown.harmonic) &&
        json::required_string(value, "harmonicRelationship", breakdown.harmonic_relationship) &&
        unit_number(value, "energy", breakdown.energy) &&
        unit_number(value, "danceability", breakdown.danceability) &&
        unit_number(value, "valence", breakdown.valence) &&
        unit_number(value, "bliss", breakdown.bliss) &&
        unit_number(value, "genre", breakdown.genre);
}

bool parse_item(const json::Value& value, CompatibleTrack& item)
{
    const auto* breakdown = json::member(value, "scoreBreakdown");
    const auto* reasons = json::member(value, "fallbackReasons");
    if (!value.is_object() || breakdown == nullptr ||
        (reasons != nullptr && !reasons->is_null() && !reasons->is_array())) {
        return false;
    }
    if (!required_int(value, "trackId", item.track_id, 1) ||
        !json::required_string(value, "trackEntityUid", item.track_entity_uid) ||
        !json::required_string(value, "title", item.title) ||
        !json::required_string(value, "artist", item.artist) ||
        !json::required_string(value, "album", item.album) ||
        !unit_number(value, "score", item.score) ||
        !unit_number(value, "confidence", item.confidence) ||
        !parse_breakdown(*breakdown, item.score_breakdown)) {
        return false;
    }
    std::string year;
    if (!json::optional_number(value, "duration", item.duration_seconds) ||
        !json::optional_number(value, "bpm", item.bpm) ||
        !json::optional_string(value, "camelot", item.camelot) ||
        !json::optional_number(value, "energy", item.energy) ||
        !json::optional_string(value, "year", year) ||
        !json::optional_string(value, "genre", item.genre) ||
        !json::optional_string(value, "coverUrl", item.cover_url)) {
        return false;
    }
    const auto parsed_year = std::from_chars(year.data(), year.data() + year.size(), item.year);
    if (parsed_year.ec != std::errc{}) {
        item.year = 0;
    }
    if (reasons != nullptr && reasons->is_array()) {
        for (const auto& reason : *reasons) {
            if (!reason.is_string() || reason.get<std::string>().empty()) {
                return false;
            }
            item.fallback_reasons.push_back(reason.get<std::string>());
        }
    }
    return true;
}

} // namespace

ParseResult<CompatibleTracks> parse_compatible_tracks_json(std::string_view body)
{
    auto parsed = json::parse_object(body);
    if (!parsed.ok()) {
        return json::failure<CompatibleTracks>(parsed.error_code, parsed.error);
    }
    const auto& root = *parsed.value;
    const auto invalid = [](std::string message) {
        return json::failure<CompatibleTracks>(ModelErrorCode::InvalidField, std::move(message));
    };

    CompatibleTracks results;
    if (!json::required_string(root, "seedTrackEntityUid", results.seed_track_entity_uid) ||
        !json::required_string(root, "scope", results.scope) || results.scope != "local" ||
        !json::required_string(root, "plannerVersion", results.planner_version) ||
        results.planner_version != kSmartMixPlannerVersion) {
        return invalid("invalid compatible tracks contract metadata");
    }

    const auto* items = json::member(root, "items");
    if (items == nullptr || !items->is_array()) {
        return invalid("compatible tracks items must be an array");
    }
    results.items.reserve(items->size());
    for (const auto& item_value : *items) {
        CompatibleTrack item;
        if (!parse_item(item_value, item)) {
            return invalid("invalid compatible track item");
        }
        results.items.push_back(std::move(item));
    }
    return json::success(std::move(results));
}

SearchTrack compatible_track_as_search_track(const CompatibleTrack& track)
{
    SearchTrack mapped;
    mapped.entity_uid = track.track_entity_uid;
    mapped.title = track.title;
    mapped.artist = track.artist;
    mapped.album = track.album;
    mapped.duration_seconds = track.duration_seconds;
    mapped.bpm = track.bpm;
    mapped.camelot = track.camelot;
    mapped.energy = track.energy;
    mapped.year = track.year;
    mapped.genre = track.genre;
    mapped.cover_url = track.cover_url;
    return mapped;
}

} // namespace crate::vdj
