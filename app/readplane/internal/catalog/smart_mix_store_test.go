package catalog

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/thecrateapp/crate/app/readplane/internal/snapshots"
)

func TestSmartMixProfileSummaryQueryIsCompact(t *testing.T) {
	assert.Contains(t, smartMixProfileSummaryQuery, "profile_revision")
	assert.Contains(t, smartMixProfileSummaryQuery, "beat_grid_format")
	assert.Contains(t, smartMixProfileSummaryQuery, "analyzed_at")
	assert.NotContains(t, smartMixProfileSummaryQuery, "beat_grid_data")
	assert.NotContains(t, smartMixProfileSummaryQuery, "profile.bliss_vector,")
}

func TestSmartMixProfileSummaryFromRow(t *testing.T) {
	analyzedAt := time.Date(2026, 7, 30, 10, 0, 0, 0, time.UTC)
	summary, err := smartMixProfileSummaryFromRow(map[string]any{
		"track_entity_uid": "123e4567-e89b-12d3-a456-426614174000",
		"profile_version":  int64(1),
		"profile_revision": "profile-a",
		"analyzer":         "crate-rust",
		"analyzer_version": "smart-mix-v1",
		"source_revision":  "source-a",
		"duration_ms":      int64(180_000),
		"quality":          "full",
		"analyzed_at":      analyzedAt,
		"bpm":              172.0,
		"intro_cue_ms":     int64(850),
	})

	require.NoError(t, err)
	assert.Equal(t, "profile-a", summary.ProfileRevision)
	assert.Equal(t, int64(180_000), summary.DurationMS)
	require.NotNil(t, summary.BPM)
	assert.Equal(t, 172.0, *summary.BPM)
	require.NotNil(t, summary.IntroCueMS)
	assert.Equal(t, int64(850), *summary.IntroCueMS)
}

func TestSmartMixProfileSummaryFromRowRejectsUnsupportedSnapshot(t *testing.T) {
	_, err := smartMixProfileSummaryFromRow(map[string]any{
		"track_entity_uid": "123e4567-e89b-12d3-a456-426614174000",
		"profile_version":  int64(2),
		"profile_revision": "future-profile",
	})

	assert.True(t, errors.Is(err, snapshots.ErrSmartMixSnapshotStale))
}
