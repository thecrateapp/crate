package routes

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/thecrateapp/crate/app/readplane/internal/auth"
	"github.com/thecrateapp/crate/app/readplane/internal/catalog"
	"github.com/thecrateapp/crate/app/readplane/internal/config"
	"github.com/thecrateapp/crate/app/readplane/internal/snapshots"
)

func newTestServerNoAuth() *Server {
	return &Server{
		cfg:    config.Config{Version: "test"},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}

func newTestServerWithAuth() *Server {
	return &Server{
		cfg:    config.Config{Version: "test"},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		auth:   auth.NewAuthenticator(nil, "", 5*time.Second),
	}
}

func newTestServerWithCatalog() *Server {
	return &Server{
		cfg:     config.Config{Version: "test"},
		logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
		auth:    auth.NewAuthenticator(nil, "", 5*time.Second),
		catalog: catalog.NewStore(nil, 5*time.Second),
	}
}

func assertMethodNotAllowed(t *testing.T, server *Server, method, path string) {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	assert.Equal(t, http.StatusMethodNotAllowed, rec.Code, "expected 405 for %s %s", method, path)
	assertJSONContentType(t, rec)
}

func assertUnauthorized(t *testing.T, server *Server, method, path string) {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code, "expected 401 for %s %s", method, path)
	assert.Equal(t, "miss", rec.Header().Get("X-Crate-Readplane"))
	assertJSONContentType(t, rec)
	var body map[string]any
	assert.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "Not authenticated", body["detail"])
}

func assertServiceUnavailable(t *testing.T, server *Server, method, path string, expectedDetail string) {
	t.Helper()
	req := httptest.NewRequest(method, path, nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code, "expected 503 for %s %s", method, path)
	assert.Equal(t, "miss", rec.Header().Get("X-Crate-Readplane"))
	assertJSONContentType(t, rec)
	var body map[string]any
	assert.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, expectedDetail, body["detail"])
}

func assertJSONContentType(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
}

// ── authMe ────────────────────────────────────────────────────────────────

func TestAuthMe_NoToken(t *testing.T) {
	assertUnauthorized(t, newTestServerWithAuth(), http.MethodGet, "/api/auth/me")
}

func TestAuthMe_MethodNotAllowed(t *testing.T) {
	assertMethodNotAllowed(t, newTestServerWithAuth(), http.MethodPost, "/api/auth/me")
}

// ── myLibraryRoute ────────────────────────────────────────────────────────

func TestMyLibraryRoute_NoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/me",
		"Readplane catalog unavailable")
}

func TestMyLibraryRoute_Unauthenticated(t *testing.T) {
	assertUnauthorized(t, newTestServerWithCatalog(), http.MethodGet, "/api/me")
}

func TestMyLibraryRoute_MethodNotAllowed(t *testing.T) {
	assertMethodNotAllowed(t, newTestServerNoAuth(), http.MethodPost, "/api/me")
}

// ── homeSlice (all 8 paths) ───────────────────────────────────────────────

var homeSlicePaths = []string{
	"/api/me/home/hero",
	"/api/me/home/recently-played",
	"/api/me/home/mixes",
	"/api/me/home/suggested-albums",
	"/api/me/home/recommended-tracks",
	"/api/me/home/radio-stations",
	"/api/me/home/favorite-artists",
	"/api/me/home/essentials",
}

func TestHomeSlice_NoToken(t *testing.T) {
	server := newTestServerWithAuth()
	for _, path := range homeSlicePaths {
		t.Run(path, func(t *testing.T) {
			assertUnauthorized(t, server, http.MethodGet, path)
		})
	}
}

func TestHomeSlice_MethodNotAllowed(t *testing.T) {
	server := newTestServerWithAuth()
	for _, path := range homeSlicePaths {
		t.Run(path, func(t *testing.T) {
			assertMethodNotAllowed(t, server, http.MethodPost, path)
		})
	}
}

func TestHomeSlice_UnknownPath(t *testing.T) {
	server := newTestServerNoAuth()
	req := httptest.NewRequest(http.MethodGet, "/api/me/home/nonexistent", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

// ── homeDiscovery ─────────────────────────────────────────────────────────

func TestHomeDiscovery_NoToken(t *testing.T) {
	assertUnauthorized(t, newTestServerWithAuth(), http.MethodGet, "/api/me/home/discovery")
}

func TestHomeDiscovery_MethodNotAllowed(t *testing.T) {
	assertMethodNotAllowed(t, newTestServerWithAuth(), http.MethodPost, "/api/me/home/discovery")
}

func TestHomeDiscovery_FreshRequiresFallback(t *testing.T) {
	// Even with an auth token, fresh=1 without fallback returns 503.
	// TEST_GAP: Valid JWT token required to get past auth; need a real or
	// mockable authenticator to test the fresh=1 flow. Skipping integration.
	t.Skip("TEST_GAP: requires valid JWT to reach fresh=1 branch")
}

// ── homeDiscoveryStream ───────────────────────────────────────────────────

func TestHomeDiscoveryStream_NoToken(t *testing.T) {
	t.Skip("TEST_GAP: SSE handler requires Flusher wrapper on ResponseRecorder and real auth; tested via integration smoke tests")
}

// ── myAlbumsRoute ─────────────────────────────────────────────────────────

func TestMyAlbumsRoute_NoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/me/albums",
		"Readplane catalog unavailable")
}

func TestMyAlbumsRoute_Unauthenticated(t *testing.T) {
	assertUnauthorized(t, newTestServerWithCatalog(), http.MethodGet, "/api/me/albums")
}

func TestMyAlbumsRoute_MethodNotAllowed(t *testing.T) {
	assertMethodNotAllowed(t, newTestServerNoAuth(), http.MethodPost, "/api/me/albums")
}

// ── myFollowsRoute ────────────────────────────────────────────────────────

func TestMyFollowsRoute_NoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/me/follows",
		"Readplane catalog unavailable")
}

func TestMyFollowsRoute_Unauthenticated(t *testing.T) {
	assertUnauthorized(t, newTestServerWithCatalog(), http.MethodGet, "/api/me/follows")
}

func TestMyFollowsRoute_MethodNotAllowed(t *testing.T) {
	assertMethodNotAllowed(t, newTestServerNoAuth(), http.MethodPost, "/api/me/follows")
}

// ── myFollowStateRoute ────────────────────────────────────────────────────

func TestMyFollowStateRoute_NoCatalog(t *testing.T) {
	// Path with one segment: /api/me/follows/artist-name
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/me/follows/some-artist",
		"Readplane catalog unavailable")
}

func TestMyFollowStateRoute_InvalidArtistID(t *testing.T) {
	// With no catalog/auth, requireCatalogUser blocks before route parsing
	// would reject the non-numeric artist ID.
	server := newTestServerNoAuth()
	req := httptest.NewRequest(http.MethodGet, "/api/me/follows/artists/notanumber", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	var body map[string]any
	assert.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "Readplane catalog unavailable", body["detail"])
}

func TestMyFollowStateRoute_MethodNotAllowed(t *testing.T) {
	assertMethodNotAllowed(t, newTestServerNoAuth(), http.MethodPost, "/api/me/follows/some-artist")
}

// ── myHistoryRoute ────────────────────────────────────────────────────────

func TestMyHistoryRoute_NoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/me/history",
		"Readplane catalog unavailable")
}

func TestMyHistoryRoute_Unauthenticated(t *testing.T) {
	assertUnauthorized(t, newTestServerWithCatalog(), http.MethodGet, "/api/me/history")
}

func TestMyHistoryRoute_MethodNotAllowed(t *testing.T) {
	assertMethodNotAllowed(t, newTestServerNoAuth(), http.MethodPost, "/api/me/history")
}

// ── myLikesRoute ──────────────────────────────────────────────────────────

func TestMyLikesRoute_NoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/me/likes",
		"Readplane catalog unavailable")
}

func TestMyLikesRoute_Unauthenticated(t *testing.T) {
	assertUnauthorized(t, newTestServerWithCatalog(), http.MethodGet, "/api/me/likes")
}

func TestMyLikesRoute_MethodNotAllowed(t *testing.T) {
	assertMethodNotAllowed(t, newTestServerNoAuth(), http.MethodPost, "/api/me/likes")
}

// ── favoritesRoute ────────────────────────────────────────────────────────

func TestFavoritesRoute_NoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/favorites",
		"Readplane catalog unavailable")
}

func TestFavoritesRoute_Unauthenticated(t *testing.T) {
	assertUnauthorized(t, newTestServerWithCatalog(), http.MethodGet, "/api/favorites")
}

func TestFavoritesRoute_MethodNotAllowed(t *testing.T) {
	assertMethodNotAllowed(t, newTestServerNoAuth(), http.MethodPost, "/api/favorites")
}

// ── genresRoute ───────────────────────────────────────────────────────────

func TestGenresRoute_NoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/genres",
		"Readplane catalog unavailable")
}

func TestGenresRoute_Unauthenticated(t *testing.T) {
	assertUnauthorized(t, newTestServerWithCatalog(), http.MethodGet, "/api/genres")
}

func TestGenresRoute_MethodNotAllowed(t *testing.T) {
	assertMethodNotAllowed(t, newTestServerNoAuth(), http.MethodPost, "/api/genres")
}

func TestGenresRoute_ReservedSlugFallsBack(t *testing.T) {
	// Reserved genre slugs (like "unmapped", "taxonomy") should hit fallback/404.
	server := newTestServerNoAuth()
	req := httptest.NewRequest(http.MethodGet, "/api/genres/unmapped", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestGenresRoute_SpecificGenreNoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/genres/punk",
		"Readplane catalog unavailable")
}

func TestGenresRoute_SpecificGenreUnauthenticated(t *testing.T) {
	assertUnauthorized(t, newTestServerWithCatalog(), http.MethodGet, "/api/genres/punk")
}

// ── searchRoute ───────────────────────────────────────────────────────────

func TestSearchRoute_NoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/search?q=test",
		"Readplane catalog unavailable")
}

func TestSearchRoute_Unauthenticated(t *testing.T) {
	assertUnauthorized(t, newTestServerWithCatalog(), http.MethodGet, "/api/search?q=test")
}

func TestSearchRoute_MethodNotAllowed(t *testing.T) {
	assertMethodNotAllowed(t, newTestServerNoAuth(), http.MethodPost, "/api/search?q=test")
}

// ── albumRoute ────────────────────────────────────────────────────────────

func TestAlbumRoute_NonNumericID(t *testing.T) {
	server := newTestServerNoAuth()
	req := httptest.NewRequest(http.MethodGet, "/api/albums/notanumber", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestAlbumRoute_ByEntityNoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet,
		"/api/albums/by-entity/123e4567-e89b-12d3-a456-426614174000",
		"Readplane catalog unavailable")
}

func TestAlbumRoute_NumericIDNoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/albums/42",
		"Readplane catalog unavailable")
}

func TestAlbumRoute_Unauthenticated(t *testing.T) {
	assertUnauthorized(t, newTestServerWithCatalog(), http.MethodGet, "/api/albums/42")
}

func TestAlbumRoute_MethodNotAllowed(t *testing.T) {
	assertMethodNotAllowed(t, newTestServerNoAuth(), http.MethodPost, "/api/albums/42")
}

func TestAlbumRoute_MalformedByEntity(t *testing.T) {
	// by-entity with a non-UUID value should fallback.
	server := newTestServerNoAuth()
	req := httptest.NewRequest(http.MethodGet, "/api/albums/by-entity/not-a-uuid", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

// ── artistRoute ───────────────────────────────────────────────────────────

func TestArtistRoute_NumericIDNoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/artists/7",
		"Readplane catalog unavailable")
}

func TestArtistRoute_Unauthenticated(t *testing.T) {
	assertUnauthorized(t, newTestServerWithCatalog(), http.MethodGet, "/api/artists/7")
}

func TestArtistRoute_MethodNotAllowed(t *testing.T) {
	assertMethodNotAllowed(t, newTestServerNoAuth(), http.MethodPost, "/api/artists/7")
}

func TestArtistRoute_TopTracksNoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/artists/7/top-tracks",
		"Readplane catalog unavailable")
}

func TestArtistRoute_ByEntityNoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet,
		"/api/artists/by-entity/123e4567-e89b-12d3-a456-426614174000",
		"Readplane catalog unavailable")
}

func TestArtistRoute_NonNumericID(t *testing.T) {
	server := newTestServerNoAuth()
	req := httptest.NewRequest(http.MethodGet, "/api/artists/notanumber", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

// ── artistSlugRoute ───────────────────────────────────────────────────────

func TestArtistSlugRoute_NoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/artist-slugs/high-vis",
		"Readplane catalog unavailable")
}

func TestArtistSlugRoute_Unauthenticated(t *testing.T) {
	assertUnauthorized(t, newTestServerWithCatalog(), http.MethodGet, "/api/artist-slugs/high-vis")
}

func TestArtistSlugRoute_MethodNotAllowed(t *testing.T) {
	assertMethodNotAllowed(t, newTestServerNoAuth(), http.MethodPost, "/api/artist-slugs/high-vis")
}

func TestArtistSlugRoute_TopTracksNoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet,
		"/api/artist-slugs/high-vis/top-tracks",
		"Readplane catalog unavailable")
}

func TestArtistSlugRoute_AlbumNoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet,
		"/api/artist-slugs/high-vis/albums/blending-sessions",
		"Readplane catalog unavailable")
}

// ── trackRoute ────────────────────────────────────────────────────────────

func TestTrackRoute_NoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/tracks/42/info",
		"Readplane catalog unavailable")
}

func TestTrackRoute_Unauthenticated(t *testing.T) {
	assertUnauthorized(t, newTestServerWithCatalog(), http.MethodGet, "/api/tracks/42/info")
}

func TestTrackRoute_MethodNotAllowed(t *testing.T) {
	assertMethodNotAllowed(t, newTestServerNoAuth(), http.MethodPost, "/api/tracks/42/info")
}

func TestTrackRoute_NonNumericID(t *testing.T) {
	server := newTestServerNoAuth()
	req := httptest.NewRequest(http.MethodGet, "/api/tracks/notanumber/info", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestTrackRoute_ByEntityUID(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet,
		"/api/tracks/by-entity/123e4567-e89b-12d3-a456-426614174000/info",
		"Readplane catalog unavailable")
}

func TestTrackRoute_UnknownAction(t *testing.T) {
	// /api/tracks/42/unknown should fallback (no handler for "unknown").
	server := newTestServerNoAuth()
	req := httptest.NewRequest(http.MethodGet, "/api/tracks/42/unknown", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestTrackRoute_EQFeaturesNoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/tracks/42/eq-features",
		"Readplane catalog unavailable")
}

func TestTrackRoute_GenreNoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/tracks/42/genre",
		"Readplane catalog unavailable")
}

func TestTrackRoute_PlaybackNoCatalog(t *testing.T) {
	assertServiceUnavailable(t, newTestServerNoAuth(), http.MethodGet, "/api/tracks/42/playback",
		"Readplane catalog unavailable")
}

func TestTrackRoute_PlaybackTranscodedFallsBack(t *testing.T) {
	// delivery != "original" (or empty) should fallback.
	server := newTestServerNoAuth()
	req := httptest.NewRequest(http.MethodGet, "/api/tracks/42/playback?delivery=tidal-flac", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

// ── cacheEvents ───────────────────────────────────────────────────────────

func TestCacheEvents_NoRedis(t *testing.T) {
	// redis=nil and no fallback → 503.
	server := newTestServerNoAuth()
	req := httptest.NewRequest(http.MethodGet, "/api/cache/events", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.Equal(t, "miss", rec.Header().Get("X-Crate-Readplane"))
	var body map[string]any
	assert.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "Readplane cache SSE is disabled", body["detail"])
}

func TestCacheEvents_MethodNotAllowed(t *testing.T) {
	assertMethodNotAllowed(t, newTestServerNoAuth(), http.MethodPost, "/api/cache/events")
}

// ── readyz ────────────────────────────────────────────────────────────────

func TestVersionHeader_PresentOnResponse(t *testing.T) {
	server := &Server{
		cfg:    config.Config{Version: "1.2.3-test"},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		auth:   auth.NewAuthenticator(nil, "", 5*time.Second),
	}
	// Use a route that doesn't need DB (authMe returns 401, but headers still set).
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	assert.NotEmpty(t, rec.Header().Get("X-Trace-ID"))
	assert.Equal(t, "1.2.3-test", rec.Header().Get("X-Crate-Readplane-Version"))
}

func TestReadyz_NeedsDBPool(t *testing.T) {
	t.Skip("TEST_GAP: readyz requires a real pgxpool.Pool for Ping(); integration smoke tests cover this")
}

func TestReadyz_MethodNotAllowed(t *testing.T) {
	assertMethodNotAllowed(t, newTestServerNoAuth(), http.MethodPost, "/readyz")
}

// ── Trace ID middleware ───────────────────────────────────────────────────

func TestTraceID_OnAllRoutes(t *testing.T) {
	// Verify trace ID header is present on all route families.
	paths := []string{
		"/api/auth/me",
		"/api/me",
		"/api/me/home/hero",
		"/api/me/home/discovery",
		"/api/me/albums",
		"/api/me/follows",
		"/api/me/history",
		"/api/me/likes",
		"/api/favorites",
		"/api/genres",
		"/api/search",
		"/api/albums/42",
		"/api/artists/7",
		"/api/artist-slugs/test",
		"/api/tracks/42/info",
		"/api/cache/events",
	}
	server := newTestServerWithAuth()
	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			server.Handler().ServeHTTP(rec, req)
			assert.NotEmpty(t, rec.Header().Get("X-Trace-ID"), "missing X-Trace-ID for %s", path)
		})
	}
}

// ── Fallback/auth error behavior ──────────────────────────────────────────

func TestFallbackOrAuthError_Unauthorized(t *testing.T) {
	// Direct call to a handler that uses fallbackOrAuthError with ErrUnauthorized.
	// authMe with no token hits this.
	server := newTestServerWithAuth()
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Equal(t, "miss", rec.Header().Get("X-Crate-Readplane"))
	var body map[string]any
	assert.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "Not authenticated", body["detail"])
}

func TestCatalogUnavailable_WithoutFallback(t *testing.T) {
	// catalog=nil, auth=nil, no fallback → requireCatalogUser returns catalogUnavailable → 503.
	server := newTestServerNoAuth()
	req := httptest.NewRequest(http.MethodGet, "/api/me/albums", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)
	assert.Equal(t, "miss", rec.Header().Get("X-Crate-Readplane"))
	var body map[string]any
	assert.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "Readplane catalog unavailable", body["detail"])
}

// ── Handler existence / routing smoke test ────────────────────────────────

func TestAllRoutes_Registered(t *testing.T) {
	// Verify all expected routes are registered and respond (even if 401/503/405).
	// /readyz excluded — requires a real pgxpool.Pool for Ping().
	routes := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/healthz"},
		{http.MethodGet, "/api/auth/me"},
		{http.MethodGet, "/api/me"},
		{http.MethodGet, "/api/me/home/hero"},
		{http.MethodGet, "/api/me/home/recently-played"},
		{http.MethodGet, "/api/me/home/mixes"},
		{http.MethodGet, "/api/me/home/suggested-albums"},
		{http.MethodGet, "/api/me/home/recommended-tracks"},
		{http.MethodGet, "/api/me/home/radio-stations"},
		{http.MethodGet, "/api/me/home/favorite-artists"},
		{http.MethodGet, "/api/me/home/essentials"},
		{http.MethodGet, "/api/me/home/discovery"},
		{http.MethodGet, "/api/me/home/discovery-stream"},
		{http.MethodGet, "/api/me/albums"},
		{http.MethodGet, "/api/me/follows"},
		{http.MethodGet, "/api/me/follows/some-artist"},
		{http.MethodGet, "/api/me/history"},
		{http.MethodGet, "/api/me/likes"},
		{http.MethodGet, "/api/favorites"},
		{http.MethodGet, "/api/genres"},
		{http.MethodGet, "/api/genres/punk"},
		{http.MethodGet, "/api/search"},
		{http.MethodGet, "/api/albums/42"},
		{http.MethodGet, "/api/albums/by-entity/123e4567-e89b-12d3-a456-426614174000"},
		{http.MethodGet, "/api/artists/7"},
		{http.MethodGet, "/api/artists/7/top-tracks"},
		{http.MethodGet, "/api/artist-slugs/high-vis"},
		{http.MethodGet, "/api/artist-slugs/high-vis/top-tracks"},
		{http.MethodGet, "/api/artist-slugs/high-vis/albums/blending-sessions"},
		{http.MethodGet, "/api/tracks/42/info"},
		{http.MethodGet, "/api/tracks/42/eq-features"},
		{http.MethodGet, "/api/tracks/42/genre"},
		{http.MethodGet, "/api/tracks/42/playback"},
		{http.MethodGet, "/api/tracks/by-entity/123e4567-e89b-12d3-a456-426614174000/info"},
		{http.MethodGet, "/api/cache/events"},
	}

	server := newTestServerWithAuth()
	for _, route := range routes {
		t.Run(route.path, func(t *testing.T) {
			req := httptest.NewRequest(route.method, route.path, nil)
			rec := httptest.NewRecorder()
			server.Handler().ServeHTTP(rec, req)
			// Every route should return something meaningful (not 404 from default mux).
			assert.NotEqual(t, http.StatusNotFound, rec.Code,
				"route %s %s returned 404 - may not be registered", route.method, route.path)
		})
	}
}

// ── Response header consistency ───────────────────────────────────────────

func TestCommonHeaders_PresentOnAllRoutes(t *testing.T) {
	// /readyz excluded — requires a real pgxpool.Pool for Ping().
	paths := []string{
		"/healthz",
		"/api/auth/me",
		"/api/me",
		"/api/me/home/hero",
		"/api/me/home/discovery",
		"/api/me/albums",
		"/api/me/follows",
		"/api/me/history",
		"/api/me/likes",
		"/api/favorites",
		"/api/genres",
		"/api/search",
		"/api/albums/42",
		"/api/artists/7",
		"/api/artist-slugs/test",
		"/api/tracks/42/info",
	}
	server := newTestServerWithAuth()
	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			server.Handler().ServeHTTP(rec, req)
			assert.Equal(t, "test", rec.Header().Get("X-Crate-Readplane-Version"),
				"missing version header for %s", path)
			assert.NotEmpty(t, rec.Header().Get("X-Trace-ID"),
				"missing trace ID for %s", path)
		})
	}
}

// ── Snapshots-dependent handlers (unit tests for helper functions only) ──

func TestHomeSlice_SnapshotDependent(t *testing.T) {
	t.Skip("TEST_GAP: requires valid JWT to reach snapshot Get() call; auth integration needed")
}

func TestHomeDiscovery_SnapshotDependent(t *testing.T) {
	t.Skip("TEST_GAP: requires valid JWT to reach snapshot Get() call; auth integration needed")
}

// ── Snapshot helper (quick sanity on decode/shape) ────────────────────────

func TestSnapshotDecodePayload_Roundtrip(t *testing.T) {
	payload, err := snapshots.DecodePayload([]byte(`{"key":"value"}`))
	assert.NoError(t, err)
	assert.Equal(t, "value", payload["key"])
}

func TestSnapshotDecodePayload_Empty(t *testing.T) {
	payload, err := snapshots.DecodePayload([]byte{})
	assert.NoError(t, err)
	assert.Empty(t, payload)
}
