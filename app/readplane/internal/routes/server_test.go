package routes

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/thecrateapp/crate/app/readplane/internal/config"
)

func TestHealthz(t *testing.T) {
	server := &Server{
		cfg:    config.Config{Version: "test"},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if rec.Header().Get("X-Crate-Readplane") != "hit" {
		t.Fatalf("X-Crate-Readplane = %q", rec.Header().Get("X-Crate-Readplane"))
	}
	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if payload["service"] != "crate-readplane" {
		t.Fatalf("payload = %+v", payload)
	}
}

func TestMethodNotAllowed(t *testing.T) {
	server := &Server{
		cfg:    config.Config{Version: "test"},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	req := httptest.NewRequest(http.MethodPost, "/healthz", nil)
	rec := httptest.NewRecorder()

	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d", rec.Code)
	}
}

func TestTraceIDGeneratedWhenMissing(t *testing.T) {
	server := &Server{
		cfg:    config.Config{Version: "test"},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	server.Handler().ServeHTTP(rec, req)

	traceID := rec.Header().Get("X-Trace-ID")
	if traceID == "" {
		t.Fatal("expected X-Trace-ID header in response")
	}
	if len(traceID) != 32 {
		t.Fatalf("expected 32-char hex trace ID, got %q (len=%d)", traceID, len(traceID))
	}
}

func TestTraceIDPropagatedWhenPresent(t *testing.T) {
	server := &Server{
		cfg:    config.Config{Version: "test"},
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("X-Trace-ID", "existing-trace-123")
	rec := httptest.NewRecorder()

	server.Handler().ServeHTTP(rec, req)

	if rec.Header().Get("X-Trace-ID") != "existing-trace-123" {
		t.Fatalf("X-Trace-ID = %q", rec.Header().Get("X-Trace-ID"))
	}
}
