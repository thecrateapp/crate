#include "crate_vdj/mix_profile.hpp"

#include "crate_vdj/json_mapping.hpp"

#include <limits>

namespace crate::vdj {
namespace {

bool optional_confidence(
    const json::Value& object,
    std::string_view name,
    std::optional<double>& output
)
{
    return json::optional_number(object, name, output) &&
        (!output.has_value() || (*output >= 0.0 && *output <= 1.0));
}

bool optional_milliseconds(
    const json::Value& object,
    std::string_view name,
    std::optional<std::int64_t>& output
)
{
    return json::optional_integer(object, name, output, 0);
}

bool optional_small_integer(
    const json::Value& object,
    std::string_view name,
    std::optional<int>& output
)
{
    std::optional<std::int64_t> value;
    if (!json::optional_integer(object, name, value, 0, std::numeric_limits<int>::max())) {
        return false;
    }
    output = value.has_value() ? std::optional<int>(static_cast<int>(*value)) : std::nullopt;
    return true;
}

bool quality_value(std::string_view value, MixProfileQuality& output)
{
    if (value == "full") {
        output = MixProfileQuality::Full;
    } else if (value == "partial") {
        output = MixProfileQuality::Partial;
    } else if (value == "legacy") {
        output = MixProfileQuality::Legacy;
    } else if (value == "unavailable") {
        output = MixProfileQuality::Unavailable;
    } else {
        return false;
    }
    return true;
}

} // namespace

ParseResult<MixProfile> parse_mix_profile_json(std::string_view body)
{
    auto parsed = json::parse_object(body);
    if (!parsed.ok()) {
        return json::failure<MixProfile>(parsed.error_code, parsed.error);
    }
    const auto& root = *parsed.value;

    MixProfile profile;
    std::int64_t profile_version = 0;
    std::string quality;
    if (!json::required_string(root, "trackEntityUid", profile.track_entity_uid) ||
        !json::required_integer(
            root,
            "profileVersion",
            profile_version,
            1,
            std::numeric_limits<int>::max()
        ) ||
        !json::required_string(root, "profileRevision", profile.profile_revision) ||
        !json::required_string(root, "analyzer", profile.analyzer) ||
        !json::required_string(root, "analyzerVersion", profile.analyzer_version) ||
        !json::required_string(root, "sourceRevision", profile.source_revision) ||
        !json::required_integer(root, "durationMs", profile.duration_ms, 0) ||
        !json::required_string(root, "quality", quality) ||
        !json::required_string(root, "analyzedAt", profile.analyzed_at) ||
        !quality_value(quality, profile.quality)) {
        return json::failure<MixProfile>(
            ModelErrorCode::InvalidField,
            "invalid required Smart Mix profile field"
        );
    }
    profile.profile_version = static_cast<int>(profile_version);
    if (profile.profile_version != kSmartMixProfileVersion) {
        return json::failure<MixProfile>(
            ModelErrorCode::UnsupportedSchema,
            "unsupported Smart Mix profile version"
        );
    }

    if (!json::optional_number(root, "bpm", profile.bpm) ||
        (profile.bpm.has_value() && *profile.bpm <= 0.0) ||
        !optional_confidence(root, "bpmConfidence", profile.bpm_confidence) ||
        !optional_confidence(root, "tempoStability", profile.tempo_stability) ||
        !optional_milliseconds(root, "beatAnchorMs", profile.beat_anchor_ms) ||
        !optional_milliseconds(root, "downbeatAnchorMs", profile.downbeat_anchor_ms) ||
        !optional_small_integer(root, "timeSignature", profile.time_signature) ||
        !json::optional_string(root, "beatGridFormat", profile.beat_grid_format) ||
        !json::optional_string(root, "key", profile.key) ||
        !json::optional_string(root, "scale", profile.scale) ||
        !json::optional_string(root, "camelot", profile.camelot) ||
        !optional_confidence(root, "keyConfidence", profile.key_confidence) ||
        !optional_milliseconds(root, "introCueMs", profile.intro_cue_ms) ||
        !optional_milliseconds(root, "outroCueMs", profile.outro_cue_ms) ||
        !json::optional_number(root, "introLufs", profile.intro_lufs) ||
        !json::optional_number(root, "outroLufs", profile.outro_lufs) ||
        !json::optional_number(root, "truePeakDbfs", profile.true_peak_dbfs) ||
        !optional_confidence(root, "introEnergy", profile.intro_energy) ||
        !optional_confidence(root, "outroEnergy", profile.outro_energy) ||
        !optional_confidence(root, "introSpectralDensity", profile.intro_spectral_density) ||
        !optional_confidence(root, "outroSpectralDensity", profile.outro_spectral_density) ||
        !optional_confidence(root, "globalEnergy", profile.global_energy) ||
        !optional_confidence(root, "danceability", profile.danceability) ||
        !optional_confidence(root, "valence", profile.valence) ||
        !json::optional_string(root, "blissVectorRevision", profile.bliss_vector_revision)) {
        return json::failure<MixProfile>(
            ModelErrorCode::InvalidField,
            "invalid optional Smart Mix profile field"
        );
    }
    return json::success(std::move(profile));
}

} // namespace crate::vdj
