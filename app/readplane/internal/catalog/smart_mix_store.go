package catalog

import (
	"context"
	"fmt"
	"time"

	"github.com/thecrateapp/crate/app/readplane/internal/postgres"
	"github.com/thecrateapp/crate/app/readplane/internal/snapshots"
)

const smartMixProfileSummaryQuery = `
	SELECT
		track.entity_uid::text AS track_entity_uid,
		profile.profile_version,
		profile.profile_revision,
		profile.analyzer,
		profile.analyzer_version,
		profile.source_revision,
		ROUND(COALESCE(track.duration, 0) * 1000)::BIGINT AS duration_ms,
		profile.quality,
		profile.analyzed_at,
		profile.bpm,
		profile.bpm_confidence,
		profile.tempo_stability,
		profile.beat_anchor_ms,
		profile.downbeat_anchor_ms,
		profile.time_signature,
		profile.beat_grid_format,
		profile.audio_key,
		profile.audio_scale,
		profile.key_camelot,
		profile.key_confidence,
		profile.intro_cue_ms,
		profile.outro_cue_ms,
		profile.intro_lufs,
		profile.outro_lufs,
		profile.true_peak_dbfs,
		profile.intro_energy,
		profile.outro_energy,
		profile.intro_spectral_density,
		profile.outro_spectral_density,
		profile.global_energy,
		profile.danceability,
		profile.valence,
		profile.bliss_vector_revision
	FROM library_tracks track
	JOIN track_mix_profiles profile ON profile.track_id = track.id
	WHERE track.entity_uid = $1::uuid
	LIMIT 1
`

// SmartMixProfileSummaryByEntityUID loads only the compact v1 profile fields.
func (s *Store) SmartMixProfileSummaryByEntityUID(
	ctx context.Context,
	entityUID string,
) (snapshots.SmartMixProfileSummary, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(
		queryCtx,
		smartMixProfileSummaryQuery,
		entityUID,
	))
	if err != nil {
		return snapshots.SmartMixProfileSummary{}, err
	}
	if len(rows) == 0 {
		return snapshots.SmartMixProfileSummary{}, ErrNotFound
	}
	return smartMixProfileSummaryFromRow(rows[0])
}

func smartMixProfileSummaryFromRow(
	row map[string]any,
) (snapshots.SmartMixProfileSummary, error) {
	analyzedAt, err := smartMixTime(row["analyzed_at"])
	if err != nil {
		return snapshots.SmartMixProfileSummary{}, err
	}
	summary := snapshots.SmartMixProfileSummary{
		TrackEntityUID:       stringValue(row["track_entity_uid"]),
		ProfileVersion:       int(intValue(row["profile_version"])),
		ProfileRevision:      stringValue(row["profile_revision"]),
		Analyzer:             stringValue(row["analyzer"]),
		AnalyzerVersion:      stringValue(row["analyzer_version"]),
		SourceRevision:       stringValue(row["source_revision"]),
		DurationMS:           intValue(row["duration_ms"]),
		Quality:              stringValue(row["quality"]),
		AnalyzedAt:           analyzedAt,
		BPM:                  optionalSmartMixFloat(row["bpm"]),
		BPMConfidence:        optionalSmartMixFloat(row["bpm_confidence"]),
		TempoStability:       optionalSmartMixFloat(row["tempo_stability"]),
		BeatAnchorMS:         optionalSmartMixInt(row["beat_anchor_ms"]),
		DownbeatAnchorMS:     optionalSmartMixInt(row["downbeat_anchor_ms"]),
		TimeSignature:        optionalSmartMixInt(row["time_signature"]),
		BeatGridFormat:       optionalSmartMixString(row["beat_grid_format"]),
		Key:                  optionalSmartMixString(row["audio_key"]),
		Scale:                optionalSmartMixString(row["audio_scale"]),
		Camelot:              optionalSmartMixString(row["key_camelot"]),
		KeyConfidence:        optionalSmartMixFloat(row["key_confidence"]),
		IntroCueMS:           optionalSmartMixInt(row["intro_cue_ms"]),
		OutroCueMS:           optionalSmartMixInt(row["outro_cue_ms"]),
		IntroLUFS:            optionalSmartMixFloat(row["intro_lufs"]),
		OutroLUFS:            optionalSmartMixFloat(row["outro_lufs"]),
		TruePeakDBFS:         optionalSmartMixFloat(row["true_peak_dbfs"]),
		IntroEnergy:          optionalSmartMixFloat(row["intro_energy"]),
		OutroEnergy:          optionalSmartMixFloat(row["outro_energy"]),
		IntroSpectralDensity: optionalSmartMixFloat(row["intro_spectral_density"]),
		OutroSpectralDensity: optionalSmartMixFloat(row["outro_spectral_density"]),
		GlobalEnergy:         optionalSmartMixFloat(row["global_energy"]),
		Danceability:         optionalSmartMixFloat(row["danceability"]),
		Valence:              optionalSmartMixFloat(row["valence"]),
		BlissVectorRevision: optionalSmartMixString(
			row["bliss_vector_revision"],
		),
	}
	if err := summary.Validate(); err != nil {
		return snapshots.SmartMixProfileSummary{}, err
	}
	return summary, nil
}

func optionalSmartMixFloat(value any) *float64 {
	if value == nil {
		return nil
	}
	parsed := floatValue(value)
	return &parsed
}

func optionalSmartMixInt(value any) *int64 {
	if value == nil {
		return nil
	}
	parsed := intValue(value)
	return &parsed
}

func optionalSmartMixString(value any) *string {
	if value == nil {
		return nil
	}
	parsed := stringValue(value)
	return &parsed
}

func smartMixTime(value any) (time.Time, error) {
	switch typed := value.(type) {
	case time.Time:
		return typed, nil
	case string:
		parsed, err := time.Parse(time.RFC3339Nano, typed)
		if err != nil {
			return time.Time{}, fmt.Errorf("parse Smart Mix analyzed_at: %w", err)
		}
		return parsed, nil
	case nil:
		return time.Time{}, nil
	default:
		return time.Time{}, fmt.Errorf(
			"parse Smart Mix analyzed_at: unsupported %T",
			value,
		)
	}
}
