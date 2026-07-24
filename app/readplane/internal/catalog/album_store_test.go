package catalog

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAlbumTracksQueryKeepsPlaybackFeaturesAndDropsUnusedScores(t *testing.T) {
	assert.Contains(t, albumTracksQuery, "bliss_vector")
	assert.Contains(t, albumTracksQuery, "bpm")
	assert.NotContains(t, albumTracksQuery, "popularity_score")
	assert.NotContains(t, albumTracksQuery, "popularity_confidence")
}
