package routes

import (
	"context"
	"encoding/json"
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
	"github.com/thecrateapp/crate/app/readplane/internal/snapshots"
)

const smartMixTestUID = "123e4567-e89b-12d3-a456-426614174000"

type staticSmartMixAuthenticator struct {
	err error
}

func (a staticSmartMixAuthenticator) Authenticate(*http.Request, bool) (*auth.User, error) {
	if a.err != nil {
		return nil, a.err
	}
	return &auth.User{ID: 7, Email: "listener@example.test", Role: "user"}, nil
}

func (a staticSmartMixAuthenticator) AuthenticateProfile(r *http.Request, allowQueryToken bool) (*auth.User, error) {
	return a.Authenticate(r, allowQueryToken)
}

func (staticSmartMixAuthenticator) InvalidateScope(string) {}

func (staticSmartMixAuthenticator) Stats() auth.IdentityCacheStats {
	return auth.IdentityCacheStats{}
}

type stubSmartMixCatalog struct {
	summary snapshots.SmartMixProfileSummary
	err     error
}

func (s stubSmartMixCatalog) SmartMixProfileSummaryByEntityUID(context.Context, string) (snapshots.SmartMixProfileSummary, error) {
	return s.summary, s.err
}

func smartMixRouteServer(store smartMixCatalog, authErr error) *Server {
	return &Server{
		cfg:             config.Config{Version: "test"},
		auth:            staticSmartMixAuthenticator{err: authErr},
		smartMixCatalog: store,
		logger:          slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}

func TestSmartMixSummaryRoute(t *testing.T) {
	bpm := 172.0
	server := smartMixRouteServer(stubSmartMixCatalog{
		summary: snapshots.SmartMixProfileSummary{
			TrackEntityUID:  smartMixTestUID,
			ProfileVersion:  1,
			ProfileRevision: "profile-a",
			Analyzer:        "crate-rust",
			AnalyzerVersion: "smart-mix-v1",
			SourceRevision:  "source-a",
			DurationMS:      180_000,
			Quality:         "full",
			AnalyzedAt:      time.Date(2026, 7, 30, 10, 0, 0, 0, time.UTC),
			BPM:             &bpm,
		},
	}, nil)
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/tracks/by-entity/"+smartMixTestUID+"/mix-profile",
		nil,
	)
	response := httptest.NewRecorder()

	server.Handler().ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, "hit", response.Header().Get("X-Crate-Readplane"))
	var payload map[string]any
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &payload))
	assert.Equal(t, "profile-a", payload["profileRevision"])
	assert.Equal(t, float64(172), payload["bpm"])
	assert.NotContains(t, payload, "beatGridMs")
}

func TestSmartMixSummaryRouteRequiresAuthentication(t *testing.T) {
	server := smartMixRouteServer(stubSmartMixCatalog{}, auth.ErrUnauthorized)
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/tracks/by-entity/"+smartMixTestUID+"/mix-profile",
		nil,
	)
	response := httptest.NewRecorder()

	server.Handler().ServeHTTP(response, request)

	assert.Equal(t, http.StatusUnauthorized, response.Code)
	assert.Equal(t, "miss", response.Header().Get("X-Crate-Readplane"))
}

func TestSmartMixSummaryRouteReturnsNotFound(t *testing.T) {
	server := smartMixRouteServer(stubSmartMixCatalog{err: catalog.ErrNotFound}, nil)
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/tracks/by-entity/"+smartMixTestUID+"/mix-profile",
		nil,
	)
	response := httptest.NewRecorder()

	server.Handler().ServeHTTP(response, request)

	assert.Equal(t, http.StatusNotFound, response.Code)
	assert.Equal(t, "hit", response.Header().Get("X-Crate-Readplane"))
}

func TestSmartMixFullProfileAlwaysFallsBackToFastAPI(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "full", r.URL.Query().Get("detail"))
		_ = httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"trackEntityUid": smartMixTestUID,
			"beatGridMs":     []int{0, 500, 1000},
		})
	}))
	defer backend.Close()
	fallback, err := httpx.NewFallbackProxy(true, backend.URL, "test")
	require.NoError(t, err)
	server := smartMixRouteServer(stubSmartMixCatalog{}, nil)
	server.fallback = fallback
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/tracks/by-entity/"+smartMixTestUID+"/mix-profile?detail=full",
		nil,
	)
	response := httptest.NewRecorder()

	server.Handler().ServeHTTP(response, request)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, "fallback", response.Header().Get("X-Crate-Readplane"))
	assert.Contains(t, response.Body.String(), "beatGridMs")
}

func TestSmartMixStaleSummaryFallsBackToFastAPI(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"trackEntityUid": smartMixTestUID,
			"profileVersion": 2,
		})
	}))
	defer backend.Close()
	fallback, err := httpx.NewFallbackProxy(true, backend.URL, "test")
	require.NoError(t, err)
	server := smartMixRouteServer(
		stubSmartMixCatalog{err: snapshots.ErrSmartMixSnapshotStale},
		nil,
	)
	server.fallback = fallback
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/tracks/by-entity/"+smartMixTestUID+"/mix-profile",
		nil,
	)
	response := httptest.NewRecorder()

	server.Handler().ServeHTTP(response, request)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, "fallback", response.Header().Get("X-Crate-Readplane"))
}
