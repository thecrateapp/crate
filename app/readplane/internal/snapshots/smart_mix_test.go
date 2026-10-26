package snapshots

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSmartMixProfileSummaryValidation(t *testing.T) {
	tests := []struct {
		name    string
		summary SmartMixProfileSummary
		wantErr error
	}{
		{
			name: "supported profile",
			summary: SmartMixProfileSummary{
				TrackEntityUID:  "123e4567-e89b-12d3-a456-426614174000",
				ProfileVersion:  1,
				ProfileRevision: "profile-a",
				Analyzer:        "crate-rust",
				AnalyzerVersion: "smart-mix-v1",
				SourceRevision:  "source-a",
				DurationMS:      180_000,
				Quality:         "full",
				AnalyzedAt:      time.Date(2026, 7, 30, 10, 0, 0, 0, time.UTC),
			},
		},
		{
			name: "new profile version falls back",
			summary: SmartMixProfileSummary{
				TrackEntityUID:  "123e4567-e89b-12d3-a456-426614174000",
				ProfileVersion:  2,
				ProfileRevision: "profile-b",
			},
			wantErr: ErrSmartMixSnapshotStale,
		},
		{
			name: "missing immutable revision falls back",
			summary: SmartMixProfileSummary{
				TrackEntityUID: "123e4567-e89b-12d3-a456-426614174000",
				ProfileVersion: 1,
			},
			wantErr: ErrSmartMixSnapshotStale,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.summary.Validate()
			assert.ErrorIs(t, err, tt.wantErr)
		})
	}
}

func TestSmartMixProfileSummaryNeverSerializesBeatGridData(t *testing.T) {
	bpm := 172.0
	summary := SmartMixProfileSummary{
		TrackEntityUID:  "123e4567-e89b-12d3-a456-426614174000",
		ProfileVersion:  1,
		ProfileRevision: "profile-a",
		Analyzer:        "crate-rust",
		AnalyzerVersion: "smart-mix-v1",
		SourceRevision:  "source-a",
		DurationMS:      180_000,
		Quality:         "full",
		AnalyzedAt:      time.Date(2026, 7, 30, 10, 0, 0, 0, time.UTC),
		BPM:             &bpm,
	}

	payload, err := json.Marshal(summary)

	require.NoError(t, err)
	assert.Contains(t, string(payload), `"profileRevision":"profile-a"`)
	assert.Contains(t, string(payload), `"bpm":172`)
	assert.NotContains(t, string(payload), "beatGridMs")
	assert.NotContains(t, string(payload), "beat_grid_data")
}

func TestSmartMixSnapshotStaleSentinelSupportsFallbackChecks(t *testing.T) {
	err := errors.Join(ErrSmartMixSnapshotStale, errors.New("unsupported profile"))
	assert.ErrorIs(t, err, ErrSmartMixSnapshotStale)
}
