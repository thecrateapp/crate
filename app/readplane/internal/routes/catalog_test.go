package routes

import (
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
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
