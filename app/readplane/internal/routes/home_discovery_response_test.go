package routes

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/thecrateapp/crate/app/readplane/internal/snapshots"
)

func TestHomeDiscoveryHTTPPayload(t *testing.T) {
	builtAt := time.Date(2026, 5, 5, 10, 0, 0, 0, time.UTC)
	staleAfter := builtAt.Add(10 * time.Minute)
	row := &snapshots.Row{
		Payload: map[string]any{
			"custom_mixes": []any{
				map[string]any{
					"name": "Daily Discovery",
					"artwork_artists": []any{
						map[string]any{"artist_id": float64(52), "artist_name": "Poison The Well"},
					},
				},
			},
		},
		Meta: snapshots.SnapshotMeta{
			Scope:        "home:discovery",
			SubjectKey:   "1",
			Version:      4,
			BuiltAt:      builtAt,
			SourceSeq:    99,
			StaleAfter:   &staleAfter,
			GenerationMS: 12,
		},
	}

	payload := homeDiscoveryHTTPPayload(row)
	snapshot, ok := payload["snapshot"].(map[string]any)
	assert.True(t, ok, "snapshot = %#v", payload["snapshot"])

	_, ok = snapshot["source_seq"]
	assert.False(t, ok, "source_seq should be omitted from HTTP response model payload")

	_, ok = payload["recommended_tracks"].([]any)
	assert.True(t, ok, "recommended_tracks default missing: %#v", payload["recommended_tracks"])

	mixes := payload["custom_mixes"].([]any)
	card := mixes[0].(map[string]any)
	assert.Nil(t, card["title"], "title default = %#v", card["title"])

	_, ok = card["tracks"].([]any)
	assert.True(t, ok, "tracks default missing: %#v", card["tracks"])

	artists := card["artwork_artists"].([]any)
	artist := artists[0].(map[string]any)
	assert.Nil(t, artist["album"])
	assert.Nil(t, artist["album_id"])
	assert.Nil(t, artist["artist"])
}
