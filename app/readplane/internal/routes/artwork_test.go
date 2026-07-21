package routes

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/thecrateapp/crate/app/readplane/internal/config"
	"github.com/thecrateapp/crate/app/readplane/internal/media"
)

type stubArtworkCatalog struct {
	key string
	err error
}

func writeRouteArtworkFixture(t *testing.T, root, kind, key string) {
	t.Helper()
	assetRoot := filepath.Join(root, "artwork-variants", "v1", kind, key)
	require.NoError(t, os.MkdirAll(filepath.Join(assetRoot, "rev"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(assetRoot, "rev", "256.webp"), []byte("webp"), 0o644))
	payload, err := json.Marshal(map[string]any{
		"version": 1, "kind": kind, "entity_key": key,
		"source_revision": "rev", "variants": map[string]string{"256": "rev/256.webp"},
	})
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(assetRoot, "current.json"), payload, 0o644))
}

func (s stubArtworkCatalog) ArtistArtworkKeyByID(context.Context, int64) (string, error) {
	return s.key, s.err
}
func (s stubArtworkCatalog) ArtistArtworkKeyByEntityUID(context.Context, string) (string, error) {
	return s.key, s.err
}
func (s stubArtworkCatalog) AlbumArtworkKeyByID(context.Context, int64) (string, error) {
	return s.key, s.err
}
func (s stubArtworkCatalog) AlbumArtworkKeyByEntityUID(context.Context, string) (string, error) {
	return s.key, s.err
}
func (s stubArtworkCatalog) GlobalArtistArtworkKey(context.Context, string) (string, error) {
	return s.key, s.err
}
func (s stubArtworkCatalog) GlobalAlbumArtworkKey(context.Context, string) (string, error) {
	return s.key, s.err
}

func TestServeMaterializedAlbumArtwork(t *testing.T) {
	root := t.TempDir()
	assetRoot := filepath.Join(root, "artwork-variants", "v1", "album-cover", "album-uid")
	require.NoError(t, os.MkdirAll(filepath.Join(assetRoot, "rev"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(assetRoot, "rev", "256.webp"), []byte("webp"), 0o644))
	payload, _ := json.Marshal(map[string]any{"version": 1, "kind": "album-cover", "entity_key": "album-uid", "source_revision": "rev", "variants": map[string]string{"256": "rev/256.webp"}})
	require.NoError(t, os.WriteFile(filepath.Join(assetRoot, "current.json"), payload, 0o644))
	server := &Server{artworkCatalog: stubArtworkCatalog{key: "album-uid"}, artworkResolver: media.NewArtworkResolver(root)}
	rec := httptest.NewRecorder()
	server.serveAlbumArtworkByID(rec, httptest.NewRequest(http.MethodGet, "/api/albums/1/cover?size=128", nil), 1)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "webp", rec.Body.String())
	assert.Equal(t, "variant", rec.Header().Get("X-Crate-Artwork"))
	assert.Equal(t, "hit", rec.Header().Get("X-Crate-Readplane"))
}

func TestNewServerResolvesArtworkFromCacheRoot(t *testing.T) {
	cacheRoot := t.TempDir()
	dataRoot := t.TempDir()
	writeRouteArtworkFixture(t, cacheRoot, "album-cover", "album-uid")
	server := NewServer(
		config.Config{DataRoot: dataRoot, CacheRoot: cacheRoot},
		nil, nil, nil, nil, nil, nil, nil,
		slog.New(slog.NewTextHandler(io.Discard, nil)),
	)

	asset, err := server.artworkResolver.Resolve("album-cover", "album-uid", 128)
	require.NoError(t, err)
	expected, err := filepath.EvalSymlinks(filepath.Join(cacheRoot, "artwork-variants", "v1", "album-cover", "album-uid", "rev", "256.webp"))
	require.NoError(t, err)
	assert.Equal(t, expected, asset.Path)
}
