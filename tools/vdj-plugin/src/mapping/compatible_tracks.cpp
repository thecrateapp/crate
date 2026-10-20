#include "crate_vdj/compatible_tracks.hpp"

#include "crate_vdj/json_mapping.hpp"

#include <iomanip>
#include <limits>
#include <sstream>

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
    return mapped;
}

std::string compatible_track_comment(const CompatibleTrack& track)
{
    const auto& breakdown = track.score_breakdown;
    std::ostringstream output;
    output << std::fixed << std::setprecision(2)
           << "Smart Mix score=" << track.score
           << " confidence=" << track.confidence
           << " tempo=" << breakdown.tempo
           << " harmonic=" << breakdown.harmonic_relationship
           << " energy=" << breakdown.energy
           << " danceability=" << breakdown.danceability
           << " valence=" << breakdown.valence
           << " bliss=" << breakdown.bliss
           << " genre=" << breakdown.genre;
    if (!track.fallback_reasons.empty()) {
        output << " fallback=";
        for (std::size_t index = 0;
             index < track.fallback_reasons.size();
             ++index) {
            if (index > 0) {
                output << ',';
            }
            output << track.fallback_reasons[index];
        }
    }
    return output.str();
}

} // namespace crate::vdj
