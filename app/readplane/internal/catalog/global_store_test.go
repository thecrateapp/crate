package catalog

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestGlobalCatalogReady(t *testing.T) {
	tests := []struct {
		name  string
		ready bool
		err   error
	}{
		{name: "ready", ready: true},
		{name: "warming", ready: false},
		{name: "query failure", err: errors.New("database unavailable")},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &Store{
				globalCatalogReadyFn: func(context.Context) (bool, error) {
					return tt.ready, tt.err
				},
			}

			ready, err := store.GlobalCatalogReady(context.Background())

			assert.Equal(t, tt.ready, ready)
			assert.ErrorIs(t, err, tt.err)
		})
	}
}

func TestCatalogServingModeForState(t *testing.T) {
	tests := []struct {
		name             string
		status           string
		hasFullReconcile bool
		want             CatalogServingMode
	}{
		{name: "cold", status: "cold", want: CatalogLocalFallback},
		{name: "first backfill", status: "backfilling", want: CatalogLocalFallback},
		{name: "first failure", status: "failed", want: CatalogLocalFallback},
		{name: "ready", status: "ready", want: CatalogGlobalReady},
		{name: "refreshing", status: "backfilling", hasFullReconcile: true, want: CatalogGlobalRefreshing},
		{name: "degraded", status: "failed", hasFullReconcile: true, want: CatalogGlobalDegraded},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, CatalogServingModeForState(tt.status, tt.hasFullReconcile))
		})
	}
}

func TestCatalogServingModeUsesGlobal(t *testing.T) {
	tests := []struct {
		mode CatalogServingMode
		want bool
	}{
		{mode: CatalogLocalFallback, want: false},
		{mode: CatalogGlobalReady, want: true},
		{mode: CatalogGlobalRefreshing, want: true},
		{mode: CatalogGlobalDegraded, want: true},
	}
	for _, tt := range tests {
		assert.Equal(t, tt.want, tt.mode.UsesGlobal())
	}
}

func TestGlobalCatalogServingMode(t *testing.T) {
	tests := []struct {
		name string
		mode CatalogServingMode
		err  error
	}{
		{name: "ready", mode: CatalogGlobalReady},
		{name: "local fallback", mode: CatalogLocalFallback},
		{name: "query failure", err: errors.New("database unavailable")},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &Store{
				globalCatalogServingModeFn: func(context.Context) (CatalogServingMode, error) {
					return tt.mode, tt.err
				},
			}

			mode, err := store.GlobalCatalogServingMode(context.Background())

			assert.Equal(t, tt.mode, mode)
			assert.ErrorIs(t, err, tt.err)
		})
	}
}

func TestCanonicalSearchSelectsAvailableReadModel(t *testing.T) {
	tests := []struct {
		name       string
		mode       CatalogServingMode
		stateErr   error
		wantSource string
		wantMode   CatalogServingMode
	}{
		{name: "cold uses local", mode: CatalogLocalFallback, wantSource: "local", wantMode: CatalogLocalFallback},
		{name: "ready uses global", mode: CatalogGlobalReady, wantSource: "global", wantMode: CatalogGlobalReady},
		{name: "refreshing uses last global", mode: CatalogGlobalRefreshing, wantSource: "global", wantMode: CatalogGlobalRefreshing},
		{name: "degraded uses last global", mode: CatalogGlobalDegraded, wantSource: "global", wantMode: CatalogGlobalDegraded},
		{name: "state failure fails open to local", stateErr: errors.New("state unavailable"), wantSource: "local", wantMode: CatalogLocalFallback},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			store := &Store{
				globalCatalogServingModeFn: func(context.Context) (CatalogServingMode, error) {
					return tt.mode, tt.stateErr
				},
				localSearchFn: func(context.Context, string, int) (map[string]any, error) {
					return map[string]any{"source": "local"}, nil
				},
				globalSearchFn: func(context.Context, string, int) (map[string]any, error) {
					return map[string]any{"source": "global"}, nil
				},
			}

			payload, mode, err := store.CanonicalSearch(context.Background(), "high vis", 20)

			assert.NoError(t, err)
			assert.Equal(t, tt.wantMode, mode)
			assert.Equal(t, tt.wantSource, payload["source"])
		})
	}
}

func TestGlobalSearchShortQueryDoesNotHitDatabase(t *testing.T) {
	store := NewStore(nil, time.Second)

	payload, err := store.GlobalSearch(context.Background(), "x", 20)

	assert.NoError(t, err)
	assert.Equal(t, []any{}, payload["artists"])
	assert.Equal(t, []any{}, payload["albums"])
	assert.Equal(t, []any{}, payload["tracks"])
}

func TestPartitionGlobalSearchDocumentRows(t *testing.T) {
	rows := []map[string]any{
		{
			"entity_type":      "artist",
			"payload_json":     map[string]any{"name": "High Vis"},
			"projection_ready": true,
		},
		{
			"entity_type":      "album",
			"payload_json":     map[string]any{"name": "Blending"},
			"projection_ready": true,
		},
		{
			"entity_type":      "__projection__",
			"payload_json":     map[string]any{},
			"projection_ready": true,
		},
	}

	payload, ready := partitionGlobalSearchDocumentRows(rows)

	assert.True(t, ready)
	assert.Equal(t, []map[string]any{{"name": "High Vis"}}, payload["artists"])
	assert.Equal(t, []map[string]any{{"name": "Blending"}}, payload["albums"])
	assert.Equal(t, []map[string]any{}, payload["tracks"])
}

func TestNormalizeGlobalSearchQueryMatchesCatalogNormalization(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  string
	}{
		{name: "accent and punctuation", query: "Björk & the!", want: "bjork and the"},
		{name: "featured suffix", query: "High Vis feat. Guest", want: "high vis"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, normalizeGlobalSearchQuery(tt.query))
		})
	}
}

func TestEscapeGlobalSearchLikePattern(t *testing.T) {
	tests := []struct {
		name  string
		query string
		want  string
	}{
		{name: "percent", query: "100%", want: "100\\%"},
		{name: "underscore", query: "a_b", want: "a\\_b"},
		{name: "backslash", query: `a\\b`, want: `a\\\\b`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, escapeGlobalSearchLike(tt.query))
		})
	}
}

func TestGlobalSearchPayloadsMatchCanonicalAPIShape(t *testing.T) {
	availability := map[string]any{"stream": true}
	artist := globalArtistSearchPayload(map[string]any{
		"global_artist_uid":       "artist-global",
		"canonical_name":          "High Vis",
		"local_artist_id":         int64(7),
		"local_artist_entity_uid": "artist-local",
		"availability_json":       availability,
		"has_local":               true,
		"has_remote":              false,
		"has_healthy_source":      true,
		"has_photo":               true,
	})
	album := globalAlbumSearchPayload(map[string]any{
		"global_album_uid":       "album-global",
		"global_artist_uid":      "artist-global",
		"canonical_name":         "Guided Tour",
		"artist_name":            "High Vis",
		"local_album_id":         int64(8),
		"local_album_entity_uid": "album-local",
		"availability_json":      availability,
		"has_local":              true,
		"has_remote":             false,
		"has_healthy_source":     true,
		"has_cover":              true,
	})
	track := globalTrackSearchPayload(map[string]any{
		"global_track_uid":       "track-global",
		"global_artist_uid":      "artist-global",
		"global_album_uid":       "album-global",
		"canonical_title":        "Talk for Hours",
		"artist_name":            "High Vis",
		"album_name":             "Guided Tour",
		"duration_seconds":       int64(201),
		"local_track_id":         int64(9),
		"local_track_entity_uid": "track-local",
		"availability_json":      availability,
		"has_local":              false,
		"has_remote":             true,
		"has_healthy_source":     true,
	})

	assert.Equal(t, map[string]any{
		"id":                      int64(7),
		"entity_uid":              "artist-local",
		"local_artist_entity_uid": "artist-local",
		"global_uid":              "artist-global",
		"global_artist_uid":       "artist-global",
		"slug":                    "high-vis",
		"name":                    "High Vis",
		"has_photo":               true,
		"availability": map[string]any{
			"stream":  true,
			"local":   true,
			"remote":  false,
			"healthy": true,
		},
	}, artist)
	assert.Equal(t, map[string]any{
		"id":                     int64(8),
		"entity_uid":             "album-local",
		"local_album_entity_uid": "album-local",
		"global_uid":             "album-global",
		"global_album_uid":       "album-global",
		"global_artist_uid":      "artist-global",
		"slug":                   "guided-tour",
		"artist_slug":            "high-vis",
		"artist":                 "High Vis",
		"name":                   "Guided Tour",
		"display_name":           "Guided Tour",
		"tracks":                 int64(0),
		"formats":                []any{},
		"size_mb":                0,
		"has_cover":              true,
		"availability": map[string]any{
			"stream":  true,
			"local":   true,
			"remote":  false,
			"healthy": true,
		},
	}, album)
	assert.Equal(t, map[string]any{
		"id":                int64(9),
		"entity_uid":        "track-local",
		"global_uid":        "track-global",
		"global_track_uid":  "track-global",
		"globalTrackUid":    "track-global",
		"global_artist_uid": "artist-global",
		"global_album_uid":  "album-global",
		"title":             "Talk for Hours",
		"artist":            "High Vis",
		"album":             "Guided Tour",
		"duration":          int64(201),
		"availability": map[string]any{
			"stream":  true,
			"local":   false,
			"remote":  true,
			"healthy": true,
		},
	}, track)
	trackWithoutAlbum := globalTrackSearchPayload(map[string]any{
		"global_track_uid":  "track-without-album",
		"global_artist_uid": "artist-global",
		"global_album_uid":  nil,
		"canonical_title":   "Demo",
		"artist_name":       "High Vis",
	})
	_, hasGlobalAlbumUID := trackWithoutAlbum["global_album_uid"]
	assert.False(t, hasGlobalAlbumUID)
}
