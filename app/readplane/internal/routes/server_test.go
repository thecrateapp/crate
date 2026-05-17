package routes

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/thecrateapp/crate/app/readplane/internal/config"
)

func newTestServer() *Server {
	return &Server{
		cfg:    config.Config{Version: "test"},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}

func TestHealthz(t *testing.T) {
	server := newTestServer()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	server.Handler().ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "hit", rec.Header().Get("X-Crate-Readplane"))
	var payload map[string]any
	assert.NoError(t, json.Unmarshal(rec.Body.Bytes(), &payload))
	assert.Equal(t, "crate-readplane", payload["service"])
}

func TestMethodNotAllowed(t *testing.T) {
	server := newTestServer()
	req := httptest.NewRequest(http.MethodPost, "/healthz", nil)
	rec := httptest.NewRecorder()

	server.Handler().ServeHTTP(rec, req)

	assert.Equal(t, http.StatusMethodNotAllowed, rec.Code)
}

func TestTraceID(t *testing.T) {
	t.Run("generated when missing", func(t *testing.T) {
		server := newTestServer()
		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		rec := httptest.NewRecorder()

		server.Handler().ServeHTTP(rec, req)

		traceID := rec.Header().Get("X-Trace-ID")
		assert.NotEmpty(t, traceID, "expected X-Trace-ID header in response")
		assert.Len(t, traceID, 32, "expected 32-char hex trace ID, got %q", traceID)
	})

	t.Run("propagated when present", func(t *testing.T) {
		server := newTestServer()
		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		req.Header.Set("X-Trace-ID", "existing-trace-123")
		rec := httptest.NewRecorder()

		server.Handler().ServeHTTP(rec, req)

		assert.Equal(t, "existing-trace-123", rec.Header().Get("X-Trace-ID"))
	})
}
