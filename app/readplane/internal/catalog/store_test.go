package catalog

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMain(m *testing.M) {
	LoadDefaultTaxonomy()
	os.Exit(m.Run())
}

func TestPublicAlbumSlug(t *testing.T) {
	got := publicAlbumSlug("2024 - High Vis - Guided Tour", "high-vis")
	assert.Equal(t, "guided-tour", got)
}

func TestSlugify(t *testing.T) {
	got := slugify("  Live in Orlando, FL 3/14/2022  ")
	assert.Equal(t, "live-in-orlando-fl-3-14-2022", got)
}

func TestLooksLikeUUID(t *testing.T) {
	assert.True(t, looksLikeUUID("123e4567-e89b-12d3-a456-426614174000"), "expected valid uuid")
	assert.False(t, looksLikeUUID("123e4567e89b12d3a456426614174000"), "accepted compact uuid")
}

func TestNormalizeFloatSlice(t *testing.T) {
	values := normalizeFloatSlice([]any{1, float64(2.5), "3"})
	assert.Equal(t, []float64{1, 2.5, 3}, values)
}

func TestDeriveBlissSignature(t *testing.T) {
	signature := deriveBlissSignature([]any{0.1, 0.2, 0.4, 0.8})
	assert.NotNil(t, signature)
	for _, key := range []string{"texture", "motion", "density"} {
		value, ok := signature[key].(float64)
		assert.True(t, ok, "%s = %#v", key, signature[key])
		assert.Greater(t, value, float64(0))
	}
}

func TestSerializeEQFeatures(t *testing.T) {
	payload := serializeEQFeatures(map[string]any{
		"energy":              0.8,
		"loudness":            -8.5,
		"dynamic_range":       11.2,
		"spectral_complexity": 0.7,
		"danceability":        0.4,
		"valence":             0.3,
		"acousticness":        0.2,
		"instrumentalness":    0.1,
	})
	assert.Equal(t, 11.2, payload["dynamicRange"])
	assert.Equal(t, 0.7, payload["brightness"])
}

func TestEmptyTrackGenrePayload(t *testing.T) {
	payload := emptyTrackGenrePayload()
	for _, key := range []string{"primary", "topLevel", "source", "preset"} {
		_, ok := payload[key]
		assert.True(t, ok, "missing %s", key)
		assert.Nil(t, payload[key], "%s = %#v", key, payload[key])
	}
}

func TestAnnotateGenreSummary(t *testing.T) {
	t.Run("mapped genre", func(t *testing.T) {
		row := map[string]any{
			"canonical_slug":        "post-hardcore",
			"canonical_name":        "post-hardcore",
			"canonical_description": "hardcore expanded into dynamics.",
			"top_level_slug":        "punk",
			"top_level_name":        "punk",
			"top_level_description": "fast and direct.",
			"canonical_eq_gains":    []float64{1, 2, 3},
			"preset_gains":          []float64{4, 5, 6},
			"preset_source":         "inherited",
			"preset_slug":           "punk",
			"preset_name":           "punk",
			"external_description":  "",
			"musicbrainz_mbid":      nil,
			"wikidata_entity_id":    nil,
			"wikidata_url":          nil,
		}

		annotateGenreSummary(row, true)

		assert.Equal(t, true, row["mapped"])
		assert.Equal(t, "hardcore expanded into dynamics.", row["description"])
		_, ok := row["canonical_eq_gains"]
		assert.False(t, ok, "leaked canonical_eq_gains")
		preset, ok := row["eq_preset_resolved"].(map[string]any)
		assert.True(t, ok, "preset = %#v", row["eq_preset_resolved"])
		assert.Equal(t, "punk", preset["slug"])
	})

	t.Run("uses static top level when DB has self-reference", func(t *testing.T) {
		row := map[string]any{
			"canonical_slug":        "hardcore-punk",
			"canonical_name":        "hardcore punk",
			"canonical_description": "hardcore description",
			"top_level_slug":        "hardcore-punk",
			"top_level_name":        "hardcore punk",
			"top_level_description": "hardcore description",
		}

		annotateGenreSummary(row, false)

		assert.Equal(t, "punk", row["top_level_slug"])
		assert.Equal(t, genreTopLevelMetadata["punk"]["description"], row["top_level_description"])
	})

	t.Run("unmapped clears taxonomy fields", func(t *testing.T) {
		row := map[string]any{
			"canonical_slug":              nil,
			"top_level_slug":              "rock",
			"description":                 "old",
			"external_description":        "old",
			"external_description_source": "old",
			"musicbrainz_mbid":            "mbid",
			"wikidata_entity_id":          "qid",
			"wikidata_url":                "url",
		}

		annotateGenreSummary(row, false)

		assert.Equal(t, false, row["mapped"])
		for _, key := range []string{"top_level_slug", "description", "external_description", "musicbrainz_mbid"} {
			assert.Nil(t, row[key], "%s = %#v", key, row[key])
		}
	})
}
