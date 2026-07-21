package catalog

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLocalMediaDescriptorFromRow(t *testing.T) {
	tests := []struct {
		name     string
		policy   string
		row      map[string]any
		root     string
		path     string
		fallback bool
	}{
		{"original", "original", map[string]any{"id": int64(3), "entity_uid": "uid", "path": "/music/a.flac", "format": "flac", "bitrate": int64(900000)}, "music", "/music/a.flac", false},
		{"balanced ready", "balanced", map[string]any{"id": int64(3), "entity_uid": "uid", "path": "/music/a.flac", "format": "flac", "preset": "balanced", "status": "ready", "relative_path": "stream-cache/a.opus", "delivery_format": "opus", "delivery_bitrate": int64(160000), "source_size": int64(42), "source_mtime_ns": int64(99)}, "data", "stream-cache/a.opus", false},
		{"adaptive missing", "data_saver", map[string]any{"id": int64(3), "path": "/music/a.flac"}, "", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := localMediaDescriptorFromRow(tt.row, tt.policy)
			if tt.fallback {
				assert.ErrorIs(t, err, ErrMediaFallback)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.root, got.Root)
			assert.Equal(t, tt.path, got.StoredPath)
			assert.Equal(t, tt.policy, got.RequestedPolicy)
		})
	}
}

func TestLocalMediaDescriptorRejectsUnknownPolicy(t *testing.T) {
	_, err := localMediaDescriptorFromRow(map[string]any{"id": int64(1)}, "auto")
	assert.True(t, errors.Is(err, ErrMediaFallback))
}

func TestAdaptiveMediaQueryRequiresReadyMatchingSource(t *testing.T) {
	assert.Contains(t, localAdaptiveMediaQuery, "sv.status = 'ready'")
	assert.Contains(t, localAdaptiveMediaQuery, "sv.source_path = t.path")
	assert.Contains(t, localAdaptiveMediaQuery, "sv.source_size = COALESCE(t.size, 0)")
	assert.Contains(t, localAdaptiveMediaQuery, "sv.preset = $2")
}
