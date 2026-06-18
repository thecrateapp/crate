package catalog

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestGenreMembershipTier(t *testing.T) {
	tests := []struct {
		name    string
		score   float64
		tier    string
		visible bool
	}{
		{name: "core", score: 0.90, tier: "core", visible: true},
		{name: "strong", score: 0.70, tier: "strong", visible: true},
		{name: "adjacent", score: 0.45, tier: "adjacent", visible: true},
		{name: "weak", score: 0.44, tier: "weak", visible: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.tier, genreMembershipTier(tt.score))
			assert.Equal(t, tt.visible, visibleGenreMembership(tt.score))
		})
	}
}

func TestAnnotateGenreSummaryAddsCoverURLForMappedGenre(t *testing.T) {
	row := map[string]any{
		"canonical_slug":        "hardcore",
		"canonical_name":        "Hardcore",
		"canonical_description": "Fast, direct, and physical.",
		"canonical_cover_path":  "hardcore.webp",
	}

	annotateGenreSummary(row, false)

	assert.Equal(t, true, row["mapped"])
	assert.Equal(t, "Fast, direct, and physical.", row["description"])
	assert.Equal(
		t,
		"/api/genres/hardcore/cover?size=640&format=webp",
		row["cover_url"],
	)
	assert.NotContains(t, row, "canonical_cover_path")
}

func TestAnnotateGenreSummaryClearsCoverURLForUnmappedGenre(t *testing.T) {
	row := map[string]any{
		"canonical_slug":       "",
		"canonical_cover_path": "raw.webp",
	}

	annotateGenreSummary(row, false)

	assert.Equal(t, false, row["mapped"])
	assert.Nil(t, row["cover_url"])
	assert.NotContains(t, row, "canonical_cover_path")
}

func TestGenreShowPayload(t *testing.T) {
	payload := genreShowPayload(map[string]any{
		"id":                int64(42),
		"date":              "2026-08-12",
		"local_time":        "20:30:00",
		"artist_name":       "Converge",
		"artist_id":         int64(7),
		"artist_slug":       "converge",
		"venue":             "Sala Test",
		"city":              "Madrid",
		"country":           "Spain",
		"tickets_url":       "https://tickets.example/show",
		"url":               "https://example/show",
		"artist_genres":     []any{"hardcore", "metalcore", "mathcore", "extra"},
		"distance_km":       float64(12.4),
		"lastfm_url":        "https://last.fm/event",
		"lastfm_attendance": int64(120),
	})

	assert.Equal(t, int64(42), payload["id"])
	assert.Equal(t, "show", payload["type"])
	assert.Equal(t, "2026-08-12", payload["date"])
	assert.Equal(t, "20:30:00", payload["time"])
	assert.Equal(t, "Converge", payload["artist"])
	assert.Equal(t, "Sala Test", payload["title"])
	assert.Equal(t, "Madrid, Spain", payload["subtitle"])
	assert.Equal(t, "https://tickets.example/show", payload["url"])
	assert.Equal(t, []string{"hardcore", "metalcore", "mathcore"}, payload["genres"])
	assert.Equal(t, true, payload["is_upcoming"])
}

func TestBuildRelatedGenrePayloadsRanksLibraryContent(t *testing.T) {
	rows := []map[string]any{
		{
			"slug":                 "metalcore",
			"page_slug":            "metalcore",
			"page_name":            "metalcore",
			"description":          "metallic hardcore pressure.",
			"artist_count":         int64(3),
			"album_count":          int64(22),
			"canonical_cover_path": "metalcore.webp",
		},
		{
			"slug":          "post-hardcore",
			"page_slug":     "post-hardcore",
			"page_name":     "post-hardcore",
			"artist_count":  int64(5),
			"album_count":   int64(19),
			"top_artist_id": int64(42),
		},
		{
			"slug":         "empty-scene",
			"page_slug":    "empty-scene",
			"page_name":    "empty scene",
			"artist_count": int64(0),
			"album_count":  int64(0),
		},
	}
	relations := map[string]string{
		"metalcore":     "related",
		"post-hardcore": "related",
		"empty-scene":   "child",
	}

	payloads := buildRelatedGenrePayloads(rows, relations, 12)

	assert.Len(t, payloads, 2)
	assert.Equal(t, "post-hardcore", payloads[0]["slug"])
	assert.Equal(t, "Related", payloads[0]["relation_label"])
	assert.Equal(t, int64(34), payloads[0]["content_score"])
	assert.Equal(t, "/api/artists/42/photo?size=640&format=webp", payloads[0]["top_artist_photo_url"])
	assert.Equal(t, "metalcore", payloads[1]["slug"])
	assert.Equal(t, "/api/genres/metalcore/cover?size=640&format=webp", payloads[1]["cover_url"])
}
