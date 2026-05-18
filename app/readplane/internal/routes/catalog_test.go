package routes

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/thecrateapp/crate/app/readplane/internal/catalog"
	"github.com/thecrateapp/crate/app/readplane/internal/httpx"
)

func TestRoutePartsDecodesSegments(t *testing.T) {
	parts, ok := routeParts("/api/artist-slugs/high-vis/albums/blending%20sessions", "/api/artist-slugs/")
	if !ok {
		t.Fatal("routeParts did not match prefix")
	}
	expected := []string{"high-vis", "albums", "blending sessions"}
	if !reflect.DeepEqual(parts, expected) {
		t.Fatalf("parts = %#v, want %#v", parts, expected)
	}
}

func TestRoutePartsRejectsEmptySegments(t *testing.T) {
	if _, ok := routeParts("/api/albums//cover", "/api/albums/"); ok {
		t.Fatal("routeParts accepted an empty segment")
	}
}

func TestBoundedQueryInt(t *testing.T) {
	req := httptest.NewRequest("GET", "/api/search?limit=500", nil)
	if got := boundedQueryInt(req, "limit", 20, 1, 50); got != 50 {
		t.Fatalf("limit = %d, want 50", got)
	}

	req = httptest.NewRequest("GET", "/api/search?limit=nope", nil)
	if got := boundedQueryInt(req, "limit", 20, 1, 50); got != 20 {
		t.Fatalf("limit = %d, want fallback 20", got)
	}
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
		if got := wantsOriginalDelivery(req); got != want {
			t.Fatalf("%s wantsOriginalDelivery = %v, want %v", path, got, want)
		}
	}
}

func TestRouteUUID(t *testing.T) {
	if !isRouteUUID("123e4567-e89b-12d3-a456-426614174000") {
		t.Fatal("expected valid uuid")
	}
	if isRouteUUID("123e4567e89b12d3a456426614174000") {
		t.Fatal("accepted uuid without separators")
	}
}

func TestReservedGenreRoute(t *testing.T) {
	if !isReservedGenreRoute("unmapped") {
		t.Fatal("expected unmapped to stay on FastAPI")
	}
	if isReservedGenreRoute("punk") {
		t.Fatal("treated a normal genre slug as reserved")
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
