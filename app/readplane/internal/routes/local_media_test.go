package routes

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/thecrateapp/crate/app/readplane/internal/catalog"
	"github.com/thecrateapp/crate/app/readplane/internal/config"
	"github.com/thecrateapp/crate/app/readplane/internal/httpx"
)

type stubLocalMediaCatalog struct {
	descriptor catalog.LocalMediaDescriptor
	err        error
}

func (s stubLocalMediaCatalog) LocalMediaByID(context.Context, int64, string) (catalog.LocalMediaDescriptor, error) {
	return s.descriptor, s.err
}
func (s stubLocalMediaCatalog) LocalMediaByEntityUID(context.Context, string, string) (catalog.LocalMediaDescriptor, error) {
	return s.descriptor, s.err
}

func TestServeLocalMediaNativeRange(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, "track.mp3"), []byte("0123456789"), 0o644))
	server := &Server{
		cfg: config.Config{LocalMediaEnabled: true, MusicRoot: root},
		localMedia: stubLocalMediaCatalog{descriptor: catalog.LocalMediaDescriptor{
			StoredPath: "track.mp3", Root: "music", RequestedPolicy: "original",
			EffectivePolicy: "original", DeliveryFormat: "mp3",
		}},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	req := httptest.NewRequest(http.MethodGet, "/api/tracks/1/stream", nil)
	req.Header.Set("Range", "bytes=1-3")
	rec := httptest.NewRecorder()
	server.serveLocalMediaByID(rec, req, 1)
	assert.Equal(t, http.StatusPartialContent, rec.Code)
	assert.Equal(t, "123", rec.Body.String())
	assert.Equal(t, "hit", rec.Header().Get("X-Crate-Readplane"))
}

func TestTrackStreamAcceptsNativeQueryToken(t *testing.T) {
	root := t.TempDir()
	require.NoError(
		t,
		os.WriteFile(filepath.Join(root, "track.mp3"), []byte("stream"), 0o644),
	)
	server := &Server{
		cfg: config.Config{
			Version:           "test",
			LocalMediaEnabled: true,
			MusicRoot:         root,
		},
		auth:    queryTokenAuthenticator{},
		catalog: catalog.NewStore(nil, 0),
		localMedia: stubLocalMediaCatalog{descriptor: catalog.LocalMediaDescriptor{
			StoredPath: "track.mp3", Root: "music", RequestedPolicy: "original",
			EffectivePolicy: "original", DeliveryFormat: "mp3",
		}},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/tracks/1/stream?token=native-token",
		nil,
	)
	response := httptest.NewRecorder()

	server.Handler().ServeHTTP(response, request)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, "stream", response.Body.String())
}

func TestServeLocalMediaReadsTranscodedVariantsFromCacheRoot(t *testing.T) {
	cacheRoot := t.TempDir()
	musicRoot := t.TempDir()
	sourcePath := filepath.Join(musicRoot, "source.flac")
	require.NoError(t, os.WriteFile(sourcePath, []byte("source"), 0o644))
	sourceInfo, err := os.Stat(sourcePath)
	require.NoError(t, err)
	relative := filepath.Join("stream-cache", "balanced", "track.opus")
	require.NoError(t, os.MkdirAll(filepath.Dir(filepath.Join(cacheRoot, relative)), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(cacheRoot, relative), []byte("cached"), 0o644))
	server := &Server{
		cfg: config.Config{LocalMediaEnabled: true, MusicRoot: musicRoot, CacheRoot: cacheRoot},
		localMedia: stubLocalMediaCatalog{descriptor: catalog.LocalMediaDescriptor{
			StoredPath: relative, Root: "data", RequestedPolicy: "balanced",
			EffectivePolicy: "balanced", DeliveryFormat: "opus", Transcoded: true,
			SourcePath: sourcePath, SourceSize: sourceInfo.Size(), SourceMtimeNS: sourceInfo.ModTime().UnixNano(),
		}},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	rec := httptest.NewRecorder()
	server.serveLocalMediaByID(rec, httptest.NewRequest(http.MethodGet, "/api/tracks/1/stream", nil), 1)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "cached", rec.Body.String())
}

func TestServeLocalMediaFallsBackWhenDisabled(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer backend.Close()
	fallback, err := httpx.NewFallbackProxy(true, backend.URL, "test")
	require.NoError(t, err)
	server := &Server{cfg: config.Config{}, fallback: fallback, logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	rec := httptest.NewRecorder()
	server.serveLocalMediaByID(rec, httptest.NewRequest(http.MethodGet, "/api/tracks/1/stream", nil), 1)
	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Equal(t, "fallback", rec.Header().Get("X-Crate-Readplane"))
}

func TestTrackStreamWithAccessTokenFallsBackToFastAPI(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Backend-Authorization", r.Header.Get("Authorization"))
		w.WriteHeader(http.StatusNoContent)
	}))
	defer backend.Close()
	fallback, err := httpx.NewFallbackProxy(true, backend.URL, "test")
	require.NoError(t, err)
	server := &Server{
		cfg:      config.Config{Version: "test", LocalMediaEnabled: true},
		auth:     queryTokenAuthenticator{},
		catalog:  catalog.NewStore(nil, 0),
		fallback: fallback,
		logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	cases := []struct {
		name string
		path string
	}{
		{"by id", "/api/tracks/1/stream"},
		{"by entity", "/api/tracks/by-entity/0b5d2c8e-6f1a-4d3b-9c7e-2a1f4e8d6b90/stream"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, tc.path, nil)
			request.Header.Set("Authorization", "Bearer crv_continuation")
			response := httptest.NewRecorder()

			server.Handler().ServeHTTP(response, request)

			assert.Equal(t, http.StatusNoContent, response.Code)
			assert.Equal(t, "fallback", response.Header().Get("X-Crate-Readplane"))
			assert.Equal(t, "Bearer crv_continuation", response.Header().Get("X-Backend-Authorization"))
		})
	}
}
