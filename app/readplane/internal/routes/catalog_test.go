package routes

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/thecrateapp/crate/app/readplane/internal/catalog"
	"github.com/thecrateapp/crate/app/readplane/internal/config"
	"github.com/thecrateapp/crate/app/readplane/internal/httpx"
)

func TestRouteParts(t *testing.T) {
	t.Run("decodes URL segments", func(t *testing.T) {
		parts, ok := routeParts("/api/artist-slugs/high-vis/albums/blending%20sessions", "/api/artist-slugs/")
		assert.True(t, ok, "routeParts did not match prefix")
		expected := []string{"high-vis", "albums", "blending sessions"}
		assert.Equal(t, expected, parts)
	})

	t.Run("rejects empty segments", func(t *testing.T) {
		_, ok := routeParts("/api/albums//cover", "/api/albums/")
		assert.False(t, ok, "routeParts accepted an empty segment")
	})
}

func TestBoundedQueryInt(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/search?limit=500", nil)
	assert.Equal(t, 50, boundedQueryInt(req, "limit", 20, 1, 50))

	req = httptest.NewRequest("GET", "/api/search?limit=nope", nil)
	assert.Equal(t, 20, boundedQueryInt(req, "limit", 20, 1, 50))
}

func TestWantsOriginalDelivery(t *testing.T) {
	for _, path := range []string{
		"/api/tracks/1/playback",
		"/api/tracks/1/playback?delivery=original",
		"/api/tracks/1/playback?delivery=ORIGINAL",
		"/api/tracks/1/playback?delivery=original-policy",
	} {
		req := httptest.NewRequest("GET", path, nil)
		want := path != "/api/tracks/1/playback?delivery=original-policy"
		assert.Equal(t, want, wantsOriginalDelivery(req), "%s", path)
	}
}

func TestIsRouteUUID(t *testing.T) {
	assert.True(t, isRouteUUID("123e4567-e89b-12d3-a456-426614174000"), "expected valid uuid")
	assert.False(t, isRouteUUID("123e4567e89b12d3a456426614174000"), "accepted uuid without separators")
}

func TestIsReservedGenreRoute(t *testing.T) {
	assert.True(t, isReservedGenreRoute("unmapped"), "expected unmapped to stay on FastAPI")
	assert.False(t, isReservedGenreRoute("punk"), "treated a normal genre slug as reserved")
}

func TestTryFallback(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer backend.Close()

	enabled, err := httpx.NewFallbackProxy(true, backend.URL, "test")
	assert.NoError(t, err)
	disabled, err := httpx.NewFallbackProxy(false, "", "test")
	assert.NoError(t, err)

	for _, test := range []struct {
		name     string
		fallback *httpx.FallbackProxy
		want     bool
	}{
		{name: "missing", fallback: nil, want: false},
		{name: "disabled", fallback: disabled, want: false},
		{name: "enabled", fallback: enabled, want: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := &Server{fallback: test.fallback}
			req := httptest.NewRequest(http.MethodGet, "/api/catalog/search", nil)
			rec := httptest.NewRecorder()

			assert.Equal(t, test.want, server.tryFallback(rec, req))
		})
	}
}

func TestCatalogPayloadFallbacksOnNotFoundWhenConfigured(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Crate-Readplane-Fallback") != "1" {
			t.Fatalf("missing fallback header")
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"source": "fastapi"})
	}))
	defer backend.Close()

	fallback, err := httpx.NewFallbackProxy(true, backend.URL, "test")
	if err != nil {
		t.Fatalf("fallback setup failed: %v", err)
	}
	server := &Server{
		fallback: fallback,
		logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	req := httptest.NewRequest("GET", "/api/artist-slugs/quicksand/albums/bring-on-the-psychics", nil)
	rec := httptest.NewRecorder()

	server.writeCatalogPayloadOrFallbackNotFound(
		rec,
		req,
		nil,
		catalog.ErrNotFound,
		"Album unavailable",
		"Not found",
	)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := rec.Header().Get("X-Crate-Readplane"); got != "fallback" {
		t.Fatalf("X-Crate-Readplane = %q, want fallback", got)
	}
}

func TestArtistPageSlugFallsBackToFastAPIForGlobalResolution(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/artist-slugs/high-vis/page", r.URL.Path)
		assert.Equal(t, "1", r.Header.Get("X-Crate-Readplane-Fallback"))
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"artist": map[string]any{"name": "High Vis"}})
	}))
	defer backend.Close()

	fallback, err := httpx.NewFallbackProxy(true, backend.URL, "test")
	if err != nil {
		t.Fatalf("fallback setup failed: %v", err)
	}
	server := &Server{
		fallback: fallback,
		logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	req := httptest.NewRequest(http.MethodGet, "/api/artist-slugs/high-vis/page", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "fallback", rec.Header().Get("X-Crate-Readplane"))
}

func TestArtistTopTracksSlugFallsBackToFastAPIForGlobalResolution(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/artist-slugs/high-vis/top-tracks", r.URL.Path)
		assert.Equal(t, "50", r.URL.Query().Get("count"))
		httpx.WriteJSON(w, http.StatusOK, []map[string]any{{"title": "Choose To Lose"}})
	}))
	defer backend.Close()

	fallback, err := httpx.NewFallbackProxy(true, backend.URL, "test")
	if err != nil {
		t.Fatalf("fallback setup failed: %v", err)
	}
	server := &Server{
		fallback: fallback,
		logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	req := httptest.NewRequest(http.MethodGet, "/api/artist-slugs/high-vis/top-tracks?count=50", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "fallback", rec.Header().Get("X-Crate-Readplane"))
}

func TestCanonicalCatalogCatchAllFallsBackToFastAPI(t *testing.T) {
	paths := []string{
		"/api/catalog/artists/artist-global-1/page",
		"/api/catalog/albums/album-global-1",
		"/api/catalog/tracks/track-global-1/playback",
		"/api/catalog/genres/hardcore-punk",
	}

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "1", r.Header.Get("X-Crate-Readplane-Fallback"))
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"path": r.URL.Path})
	}))
	defer backend.Close()

	fallback, err := httpx.NewFallbackProxy(true, backend.URL, "test")
	if err != nil {
		t.Fatalf("fallback setup failed: %v", err)
	}
	server := &Server{
		cfg:      config.Config{Version: "test"},
		fallback: fallback,
		logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			server.Handler().ServeHTTP(rec, req)

			assert.Equal(t, http.StatusOK, rec.Code)
			assert.Equal(t, "fallback", rec.Header().Get("X-Crate-Readplane"))
		})
	}
}
