package snapshots

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

const SmartMixProfileVersion = 1

var ErrSmartMixSnapshotStale = errors.New("Smart Mix snapshot requires FastAPI fallback")

// SmartMixProfileSummary is the compact, credential-free profile contract
// served by readplane v1. Full beat grids deliberately remain in FastAPI.
type SmartMixProfileSummary struct {
	TrackEntityUID       string    `json:"trackEntityUid"`
	ProfileVersion       int       `json:"profileVersion"`
	ProfileRevision      string    `json:"profileRevision"`
	Analyzer             string    `json:"analyzer"`
	AnalyzerVersion      string    `json:"analyzerVersion"`
	SourceRevision       string    `json:"sourceRevision"`
	DurationMS           int64     `json:"durationMs"`
	Quality              string    `json:"quality"`
	AnalyzedAt           time.Time `json:"analyzedAt"`
	BPM                  *float64  `json:"bpm,omitempty"`
	BPMConfidence        *float64  `json:"bpmConfidence,omitempty"`
	TempoStability       *float64  `json:"tempoStability,omitempty"`
	BeatAnchorMS         *int64    `json:"beatAnchorMs,omitempty"`
	DownbeatAnchorMS     *int64    `json:"downbeatAnchorMs,omitempty"`
	TimeSignature        *int64    `json:"timeSignature,omitempty"`
	BeatGridFormat       *string   `json:"beatGridFormat,omitempty"`
	Key                  *string   `json:"key,omitempty"`
	Scale                *string   `json:"scale,omitempty"`
	Camelot              *string   `json:"camelot,omitempty"`
	KeyConfidence        *float64  `json:"keyConfidence,omitempty"`
	IntroCueMS           *int64    `json:"introCueMs,omitempty"`
	OutroCueMS           *int64    `json:"outroCueMs,omitempty"`
	IntroLUFS            *float64  `json:"introLufs,omitempty"`
	OutroLUFS            *float64  `json:"outroLufs,omitempty"`
	TruePeakDBFS         *float64  `json:"truePeakDbfs,omitempty"`
	IntroEnergy          *float64  `json:"introEnergy,omitempty"`
	OutroEnergy          *float64  `json:"outroEnergy,omitempty"`
	IntroSpectralDensity *float64  `json:"introSpectralDensity,omitempty"`
	OutroSpectralDensity *float64  `json:"outroSpectralDensity,omitempty"`
	GlobalEnergy         *float64  `json:"globalEnergy,omitempty"`
	Danceability         *float64  `json:"danceability,omitempty"`
	Valence              *float64  `json:"valence,omitempty"`
	BlissVectorRevision  *string   `json:"blissVectorRevision,omitempty"`
}

// Validate rejects summaries that readplane v1 cannot safely represent.
// Callers fall back to FastAPI, which owns forward-compatible full profiles.
func (s SmartMixProfileSummary) Validate() error {
	if s.ProfileVersion != SmartMixProfileVersion {
		return fmt.Errorf(
			"%w: unsupported profile version %d",
			ErrSmartMixSnapshotStale,
			s.ProfileVersion,
		)
	}
	if strings.TrimSpace(s.TrackEntityUID) == "" ||
		strings.TrimSpace(s.ProfileRevision) == "" ||
		strings.TrimSpace(s.Analyzer) == "" ||
		strings.TrimSpace(s.AnalyzerVersion) == "" ||
		strings.TrimSpace(s.SourceRevision) == "" ||
		s.AnalyzedAt.IsZero() ||
		s.DurationMS < 0 {
		return fmt.Errorf(
			"%w: incomplete profile summary",
			ErrSmartMixSnapshotStale,
		)
	}
	switch s.Quality {
	case "full", "partial", "legacy", "unavailable":
	default:
		return fmt.Errorf(
			"%w: unsupported profile quality %q",
			ErrSmartMixSnapshotStale,
			s.Quality,
		)
	}
	return nil
}
