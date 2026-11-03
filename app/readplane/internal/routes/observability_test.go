package routes

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/thecrateapp/crate/app/readplane/internal/config"
	"github.com/thecrateapp/crate/app/readplane/internal/httpx"
	"github.com/thecrateapp/crate/app/readplane/internal/observability"
)

func TestFallbackSuccessRatio(t *testing.T) {
	tests := []struct {
		name  string
		stats httpx.FallbackStats
		want  float64
	}{
		{name: "empty", stats: httpx.FallbackStats{}, want: 0},
		{name: "mixed", stats: httpx.FallbackStats{Attempts: 10, Successes: 7}, want: 0.7},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.InDelta(t, tt.want, fallbackSuccessRatio(tt.stats), 0.0001)
		})
	}
}

func TestReadinessStatusTreatsCacheRedisAsOptional(t *testing.T) {
	tests := []struct {
		name          string
		postgresReady bool
		schemaReady   bool
		redisReady    bool
		enableSSE     bool
		wantStatus    int
		wantDegraded  bool
	}{
		{name: "all ready", postgresReady: true, schemaReady: true, redisReady: true, enableSSE: true, wantStatus: 200},
		{name: "cache redis down", postgresReady: true, schemaReady: true, enableSSE: true, wantStatus: 200, wantDegraded: true},
		{name: "sse disabled", postgresReady: true, schemaReady: true, enableSSE: false, wantStatus: 200},
		{name: "postgres down", schemaReady: true, redisReady: true, enableSSE: true, wantStatus: 503},
		{name: "schema missing", postgresReady: true, redisReady: true, enableSSE: true, wantStatus: 503},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, degraded := readinessStatus(tt.postgresReady, tt.schemaReady, tt.redisReady, tt.enableSSE)
			assert.Equal(t, tt.wantStatus, status)
			assert.Equal(t, tt.wantDegraded, degraded)
		})
	}
}

func TestMetricsAreServedOnlyByTheInternalHandler(t *testing.T) {
	server := &Server{
		cfg:            config.Config{Version: "test"},
		logger:         slog.New(slog.NewTextHandler(io.Discard, nil)),
		mediaMetrics:   observability.NewMediaMetrics(),
		requestMetrics: observability.NewRequestMetrics(),
	}
	public := server.Handler()
	health := httptest.NewRecorder()
	public.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	assert.Equal(t, http.StatusOK, health.Code)

	tests := []struct {
		name     string
		handler  http.Handler
		method   string
		path     string
		status   int
		contains string
	}{
		{"internal scrape", server.MetricsHandler(), http.MethodGet, "/metrics", http.StatusOK, `crate_readplane_requests_total{source="hit",status_class="2xx"} 1`},
		{"internal other path", server.MetricsHandler(), http.MethodGet, "/readyz", http.StatusNotFound, ""},
		{"internal post", server.MetricsHandler(), http.MethodPost, "/metrics", http.StatusNotFound, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			tt.handler.ServeHTTP(rec, httptest.NewRequest(tt.method, tt.path, nil))
			assert.Equal(t, tt.status, rec.Code)
			assert.Contains(t, rec.Body.String(), tt.contains)
		})
	}

	public = server.Handler()
	rec := httptest.NewRecorder()
	public.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	assert.NotContains(t, rec.Body.String(), "crate_readplane_requests_total")
}
