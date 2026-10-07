#pragma once

#include "crate_vdj/models.hpp"

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace crate::vdj {

enum class MixProfileQuality {
    Full,
    Partial,
    Legacy,
    Unavailable,
};

struct MixProfile {
    std::string track_entity_uid;
    int profile_version = 0;
    std::string profile_revision;
    std::string analyzer;
    std::string analyzer_version;
    std::string source_revision;
    std::int64_t duration_ms = 0;
    MixProfileQuality quality = MixProfileQuality::Unavailable;
    std::string analyzed_at;

    std::optional<double> bpm;
    std::optional<double> bpm_confidence;
    std::optional<double> tempo_stability;
    std::optional<std::int64_t> beat_anchor_ms;
    std::optional<std::int64_t> downbeat_anchor_ms;
    std::optional<int> time_signature;
    std::optional<std::string> beat_grid_format;
    std::optional<std::string> key;
    std::optional<std::string> scale;
    std::optional<std::string> camelot;
    std::optional<double> key_confidence;
    std::optional<std::int64_t> intro_cue_ms;
    std::optional<std::int64_t> outro_cue_ms;
    std::optional<double> intro_lufs;
    std::optional<double> outro_lufs;
    std::optional<double> true_peak_dbfs;
    std::optional<double> intro_energy;
    std::optional<double> outro_energy;
    std::optional<double> intro_spectral_density;
    std::optional<double> outro_spectral_density;
    std::optional<double> global_energy;
    std::optional<double> danceability;
    std::optional<double> valence;
    std::optional<std::string> bliss_vector_revision;

    bool available() const
    {
        return quality != MixProfileQuality::Unavailable;
    }
};

inline constexpr std::string_view kSmartMixAnalyzerVersion = "smart-mix-v1";
inline constexpr int kSmartMixProfileVersion = 1;

ParseResult<MixProfile> parse_mix_profile_json(std::string_view json);

} // namespace crate::vdj
