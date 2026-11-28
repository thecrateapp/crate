package routes

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/thecrateapp/crate/app/readplane/internal/auth"
	"github.com/thecrateapp/crate/app/readplane/internal/catalog"
	"github.com/thecrateapp/crate/app/readplane/internal/config"
	"github.com/thecrateapp/crate/app/readplane/internal/httpx"
)

func TestShouldFallBackForAccessToken(t *testing.T) {
	for _, test := range []struct {
		name          string
		path          string
		authorization string
		want          bool
	}{
		{name: "native device token on an API route", path: "/api/albums/1/cover", authorization: "Bearer crv_device", want: true},
		{name: "virtualdj token on search", path: "/api/search", authorization: "Bearer crv_vdj", want: true},
		{name: "session JWT stays native", path: "/api/albums/1/cover", authorization: "Bearer eyJhbGciOi.payload.sig", want: false},
		{name: "no credential stays native", path: "/api/albums/1/cover", authorization: "", want: false},
		{name: "crv_ outside the Bearer scheme", path: "/api/albums/1/cover", authorization: "crv_device", want: false},
		{name: "lowercase scheme is not an access token", path: "/api/albums/1/cover", authorization: "bearer crv_device", want: false},
		{name: "non-API path stays native", path: "/healthz", authorization: "Bearer crv_device", want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, test.path, nil)
			if test.authorization != "" {
				req.Header.Set("Authorization", test.authorization)
			}
			assert.Equal(t, test.want, shouldFallBackForAccessToken(req))
		})
	}
}

// Native device tokens (AA2) reach every readplane-served route of their
// FastAPI allowlist; FastAPI validates them. Before AA2 only search and
// /api/tracks/* handed crv_ over: artwork and /api/me/* answered 401.
func TestNativeDeviceTokenReadplaneRoutesFallBackToFastAPI(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Backend-Authorization", r.Header.Get("Authorization"))
		w.Header().Set("X-Backend-Method", r.Method)
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()
	fallback, err := httpx.NewFallbackProxy(true, backend.URL, "test")
	require.NoError(t, err)
	server := &Server{
		cfg:             config.Config{Version: "test"},
		logger:          slog.New(slog.NewTextHandler(io.Discard, nil)),
		auth:            auth.NewAuthenticator(nil, "test-jwt-secret", 5*time.Second),
		catalog:         catalog.NewStore(nil, 5*time.Second),
		artworkCatalog:  stubArtworkCatalog{key: "album-uid"},
		smartMixCatalog: stubSmartMixCatalog{},
		fallback:        fallback,
	}
	const token = "Bearer crv_native_device"

	for _, test := range []struct {
		name   string
		method string
		path   string
	}{
		{name: "auth me", method: http.MethodGet, path: "/api/auth/me"},
		{name: "album cover by id", method: http.MethodGet, path: "/api/albums/7/cover"},
		{name: "album cover head", method: http.MethodHead, path: "/api/albums/7/cover"},
		{name: "album cover by entity", method: http.MethodGet, path: "/api/albums/by-entity/" + smartMixTestUID + "/cover"},
		{name: "artist photo by id", method: http.MethodGet, path: "/api/artists/7/photo"},
		{name: "artist background by entity", method: http.MethodGet, path: "/api/artists/by-entity/" + smartMixTestUID + "/background"},
		{name: "catalog album cover", method: http.MethodGet, path: "/api/catalog/albums/global-album/cover"},
		{name: "catalog artist photo", method: http.MethodGet, path: "/api/catalog/artists/global-artist/photo"},
		{name: "catalog track stream", method: http.MethodGet, path: "/api/catalog/tracks/global-track/stream"},
		{name: "track stream by id", method: http.MethodGet, path: "/api/tracks/7/stream"},
		{name: "track stream by entity", method: http.MethodHead, path: "/api/tracks/by-entity/" + smartMixTestUID + "/stream"},
		{name: "track playback by entity", method: http.MethodGet, path: "/api/tracks/by-entity/" + smartMixTestUID + "/playback"},
		{name: "outside the allowlist FastAPI refuses it", method: http.MethodGet, path: "/api/me/likes"},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(test.method, test.path, nil)
			req.Header.Set("Authorization", token)
			rec := httptest.NewRecorder()

			server.Handler().ServeHTTP(rec, req)

			assert.Equal(t, http.StatusOK, rec.Code)
			assert.Equal(t, "fallback", rec.Header().Get("X-Crate-Readplane"))
			assert.Equal(t, token, rec.Header().Get("X-Backend-Authorization"))
			assert.Equal(t, test.method, rec.Header().Get("X-Backend-Method"))
		})
	}
}

func TestAccessTokenWithoutFallbackKeepsTheNativeAnswer(t *testing.T) {
	server := &Server{
		cfg:            config.Config{Version: "test"},
		logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
		auth:           auth.NewAuthenticator(nil, "test-jwt-secret", 5*time.Second),
		catalog:        catalog.NewStore(nil, 5*time.Second),
		artworkCatalog: stubArtworkCatalog{key: "album-uid"},
	}
	req := httptest.NewRequest(http.MethodGet, "/api/albums/7/cover", nil)
	req.Header.Set("Authorization", "Bearer crv_native_device")
	rec := httptest.NewRecorder()

	server.Handler().ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Equal(t, "miss", rec.Header().Get("X-Crate-Readplane"))
}
