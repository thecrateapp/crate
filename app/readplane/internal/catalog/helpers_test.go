package catalog

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// ── formatArtistTopTrack ──

func TestFormatArtistTopTrack(t *testing.T) {
	row := map[string]any{
		"id":            int64(42),
		"title":         "Guided Tour",
		"artist":        "High Vis",
		"artist_id":     "artist-1",
		"artist_slug":   "high-vis",
		"album":         "Guided Tour",
		"album_id":      "album-1",
		"album_slug":    "guided-tour",
		"duration":      float64(217),
		"track_number":  float64(3),
		"format":        "flac",
		"bpm":           float64(140),
		"audio_key":     "D",
		"audio_scale":   "minor",
		"energy":        float64(0.8),
		"danceability":  float64(0.4),
		"valence":       float64(0.3),
		"bliss_vector":  []float64{0.1, 0.2},
	}

	result := formatArtistTopTrack(row)

	assert.Equal(t, "42", result["id"])
	assert.Equal(t, int64(42), result["track_id"])
	assert.Equal(t, "Guided Tour", result["title"])
	assert.Equal(t, float64(217), result["duration"])
	assert.Equal(t, float64(3), result["track"])
	assert.Equal(t, []float64{0.1, 0.2}, result["bliss_vector"])
}

func TestFormatArtistTopTrackDefaults(t *testing.T) {
	row := map[string]any{
		"id":    int64(1),
		"title": "Unknown",
	}

	result := formatArtistTopTrack(row)

	assert.Equal(t, int64(0), result["duration"])
	assert.Equal(t, int64(0), result["track"])
}

// ── serializeTrackInfo ──

func TestSerializeTrackInfo(t *testing.T) {
	row := map[string]any{
		"id":          int64(1),
		"title":       "Test Track",
		"storage_id":  "st-123",
		"path":        "/music/artist/album/track.flac",
		"bliss_vector": []float64{0.1, 0.2, 0.4, 0.8},
	}

	result := serializeTrackInfo(row)

	assert.NotContains(t, result, "storage_id")
	assert.NotContains(t, result, "path")
	assert.NotContains(t, result, "bliss_vector")
	assert.NotNil(t, result["bliss_signature"])
	assert.Equal(t, "Test Track", result["title"])

	sig, ok := result["bliss_signature"].(map[string]any)
	assert.True(t, ok)
	assert.Contains(t, sig, "texture")
	assert.Contains(t, sig, "motion")
	assert.Contains(t, sig, "density")
}

func TestSerializeTrackInfoNilBlissVector(t *testing.T) {
	row := map[string]any{
		"id":           int64(1),
		"title":        "No Bliss",
		"bliss_vector": nil,
	}

	result := serializeTrackInfo(row)
	assert.Nil(t, result["bliss_signature"])
}

// ── playbackPayload ──

func TestPlaybackPayload(t *testing.T) {
	row := map[string]any{
		"format":      "flac",
		"path":        "/music/artist/album/track.flac",
		"bitrate":     int64(900),
		"sample_rate": int64(44100),
		"bit_depth":   int64(24),
		"size":        int64(25000000),
		"entity_uid":  "abc-123-def",
	}

	result := playbackPayload(row, "original")

	assert.Contains(t, result["stream_url"], "/by-entity/abc-123-def/stream")
	assert.Equal(t, "original", result["requested_policy"])
	assert.Equal(t, "original", result["effective_policy"])
	assert.Equal(t, false, result["transcoded"])
	assert.Equal(t, false, result["cache_hit"])

	source, ok := result["source"].(map[string]any)
	assert.True(t, ok)
	assert.Equal(t, "flac", source["format"])
	assert.True(t, source["lossless"].(bool))
	assert.Equal(t, int64(900), source["bitrate"])
	assert.Equal(t, int64(44100), source["sample_rate"])
	assert.Equal(t, int64(24), source["bit_depth"])
	assert.Equal(t, int64(25000000), source["bytes"])

	delivery, ok := result["delivery"].(map[string]any)
	assert.True(t, ok)
	assert.Equal(t, "original_requested", delivery["reason"])
}

func TestPlaybackPayloadInferFormatFromPath(t *testing.T) {
	row := map[string]any{
		"format":      "",
		"path":        "/music/artist/album/track.m4a",
		"bitrate":     int64(320),
		"sample_rate": nil,
		"bit_depth":   nil,
		"size":        nil,
	}

	result := playbackPayload(row, "")

	source := result["source"].(map[string]any)
	assert.Equal(t, "aac", source["format"])
	assert.False(t, source["lossless"].(bool))
	assert.Nil(t, source["sample_rate"])
	assert.Nil(t, source["bit_depth"])
	assert.Nil(t, source["bytes"])
}

func TestPlaybackPayloadFallbackToID(t *testing.T) {
	row := map[string]any{
		"id":     int64(789),
		"format": "mp3",
		"path":   "/music/track.mp3",
		"size":   int64(8000000),
	}

	result := playbackPayload(row, "transcode_320")

	assert.Contains(t, result["stream_url"], "/tracks/789/stream")
	assert.Contains(t, result["stream_url"], "delivery=transcode_320")
}

// ── streamURL ──

func TestStreamURL(t *testing.T) {
	t.Run("by entity UID", func(t *testing.T) {
		row := map[string]any{"entity_uid": "abc-123"}
		u := streamURL(row, "")
		assert.Equal(t, "/api/tracks/by-entity/abc-123/stream", u)
	})

	t.Run("by entity UID with policy", func(t *testing.T) {
		row := map[string]any{"entity_uid": "abc-123"}
		u := streamURL(row, "transcode_320")
		assert.Equal(t, "/api/tracks/by-entity/abc-123/stream?delivery=transcode_320", u)
	})

	t.Run("by track ID", func(t *testing.T) {
		row := map[string]any{"id": int64(42)}
		u := streamURL(row, "original")
		assert.Equal(t, "/api/tracks/42/stream", u)
	})

	t.Run("by track ID with policy", func(t *testing.T) {
		row := map[string]any{"id": int64(42)}
		u := streamURL(row, "transcode_opus")
		assert.Equal(t, "/api/tracks/42/stream?delivery=transcode_opus", u)
	})

	t.Run("fallback to path", func(t *testing.T) {
		row := map[string]any{"path": "/music/artist/album/track.flac"}
		u := streamURL(row, "")
		// TrimLeft strips all "/" chars from string left, so the leading /
		// of /music/artist/... is removed, yielding music/artist/...
		assert.Equal(t, "/api/stream/music/artist/album/track.flac", u)
	})

	t.Run("empty row falls back to path", func(t *testing.T) {
		row := map[string]any{}
		u := streamURL(row, "")
		assert.Equal(t, "/api/stream/", u)
	})

	t.Run("zero ID falls back to path", func(t *testing.T) {
		row := map[string]any{"id": int64(0), "path": "/music/track.mp3"}
		u := streamURL(row, "")
		assert.Equal(t, "/api/stream/music/track.mp3", u)
	})

	t.Run("entity UID takes precedence over ID", func(t *testing.T) {
		row := map[string]any{"entity_uid": "uid-first", "id": int64(99)}
		u := streamURL(row, "")
		assert.Contains(t, u, "by-entity/uid-first")
	})
}

// ── displayName ──

func TestDisplayName(t *testing.T) {
	t.Run("strips year prefix with dash", func(t *testing.T) {
		assert.Equal(t, "Guided Tour", displayName("2024 - Guided Tour"))
	})

	t.Run("strips year prefix with en-dash", func(t *testing.T) {
		assert.Equal(t, "Guided Tour 2024", displayName("2024 \u2013 Guided Tour 2024"))
	})

	t.Run("no year prefix", func(t *testing.T) {
		assert.Equal(t, "Some Album", displayName("Some Album"))
	})

	t.Run("empty string", func(t *testing.T) {
		assert.Equal(t, "", displayName(""))
	})

	t.Run("only year", func(t *testing.T) {
		assert.Equal(t, "", displayName("2024 - "))
	})
}

// ── inferFormat ──

func TestInferFormat(t *testing.T) {
	t.Run("from format field", func(t *testing.T) {
		assert.Equal(t, "flac", inferFormat("flac", ""))
		assert.Equal(t, "mp3", inferFormat("mp3", "/music/track.flac"))
	})

	t.Run("m4a maps to aac", func(t *testing.T) {
		assert.Equal(t, "aac", inferFormat("m4a", ""))
		assert.Equal(t, "aac", inferFormat(".m4a", ""))
	})

	t.Run("strips leading dot", func(t *testing.T) {
		assert.Equal(t, "flac", inferFormat(".flac", ""))
	})

	t.Run("case insensitive", func(t *testing.T) {
		assert.Equal(t, "flac", inferFormat("FLAC", ""))
		assert.Equal(t, "mp3", inferFormat("Mp3", ""))
	})

	t.Run("falls back to path extension", func(t *testing.T) {
		assert.Equal(t, "flac", inferFormat("", "/music/track.FLAC"))
		assert.Equal(t, "mp3", inferFormat("", "/music/track.mp3"))
	})

	t.Run("path m4a maps to aac", func(t *testing.T) {
		assert.Equal(t, "aac", inferFormat("", "/music/track.m4a"))
	})

	t.Run("no extension returns empty", func(t *testing.T) {
		assert.Equal(t, "", inferFormat("", "/music/track"))
	})

	t.Run("both empty returns empty", func(t *testing.T) {
		assert.Equal(t, "", inferFormat("", ""))
	})

	t.Run("dot only in path", func(t *testing.T) {
		assert.Equal(t, "", inferFormat("", "/music/track."))
	})
}

// ── isLossless ──

func TestIsLossless(t *testing.T) {
	assert.True(t, isLossless("flac"))
	assert.True(t, isLossless("FLAC"))
	assert.True(t, isLossless("wav"))
	assert.True(t, isLossless("alac"))
	assert.True(t, isLossless("aiff"))
	assert.True(t, isLossless("aif"))
	assert.False(t, isLossless("mp3"))
	assert.False(t, isLossless("aac"))
	assert.False(t, isLossless("opus"))
	assert.False(t, isLossless("vorbis"))
	assert.False(t, isLossless(""))
}

// ── bitrateKbps ──

func TestBitrateKbps(t *testing.T) {
	assert.Nil(t, bitrateKbps(nil))
	assert.Nil(t, bitrateKbps(int64(0)))
	assert.Nil(t, bitrateKbps(int64(-1)))
	assert.Equal(t, int64(320), bitrateKbps(int64(320)))
	assert.Equal(t, int64(900), bitrateKbps(int64(900)))
	assert.Equal(t, int64(1411), bitrateKbps(int64(1411)))
	assert.Equal(t, int64(4000), bitrateKbps(int64(4000)))
	assert.Equal(t, int64(9), bitrateKbps(int64(9000)))
	assert.Equal(t, int64(14), bitrateKbps(int64(14112)))
	assert.Equal(t, int64(2117), bitrateKbps(float64(2116800)))
	assert.Equal(t, int64(320), bitrateKbps("320"))
}

// ── relativeMusicPath ──

func TestRelativeMusicPath(t *testing.T) {
	assert.Equal(t, "artist/album/track.flac", relativeMusicPath("/music/artist/album/track.flac"))
}

func TestRelativeMusicPathNonMusic(t *testing.T) {
	assert.Equal(t, "tmp/staging/track.flac", relativeMusicPath("/tmp/staging/track.flac"))
	assert.Equal(t, "var/data", relativeMusicPath("/var/data"))
	assert.Equal(t, "relative/path", relativeMusicPath("relative/path"))
	assert.Equal(t, "", relativeMusicPath(""))
	assert.Equal(t, "", relativeMusicPath("/"))
}

// ── cloneMap ──

func TestCloneMap(t *testing.T) {
	original := map[string]any{
		"a": 1,
		"b": "two",
		"c": []int{3, 4},
	}
	cloned := cloneMap(original)

	assert.Equal(t, original, cloned)

	cloned["d"] = 5
	assert.NotContains(t, original, "d")
}

func TestCloneMapEmpty(t *testing.T) {
	cloned := cloneMap(map[string]any{})
	assert.Empty(t, cloned)
	assert.NotNil(t, cloned)
}

func TestCloneMapNil(t *testing.T) {
	cloned := cloneMap(nil)
	assert.Empty(t, cloned)
	assert.NotNil(t, cloned)
}

// ── rowsToMaps ──
// TEST_GAP: rowsToMaps requires a pgx.Rows connection which needs a database.
// Tested indirectly via integration tests in the store layer.

// ── normalizeValue ──

func TestNormalizeValue(t *testing.T) {
	t.Run("nil stays nil", func(t *testing.T) {
		assert.Nil(t, normalizeValue(nil))
	})

	t.Run("string unchanged", func(t *testing.T) {
		assert.Equal(t, "hello", normalizeValue("hello"))
	})

	t.Run("int unchanged", func(t *testing.T) {
		assert.Equal(t, int64(42), normalizeValue(int64(42)))
	})

	t.Run("[]byte JSON decoded", func(t *testing.T) {
		result := normalizeValue([]byte(`{"key": "value"}`))
		m, ok := result.(map[string]any)
		assert.True(t, ok)
		assert.Equal(t, "value", m["key"])
	})

	t.Run("[]byte JSON array decoded", func(t *testing.T) {
		result := normalizeValue([]byte(`[1, 2, 3]`))
		arr, ok := result.([]any)
		assert.True(t, ok)
		assert.Equal(t, 3, len(arr))
	})

	t.Run("[]byte non-JSON returned as string", func(t *testing.T) {
		result := normalizeValue([]byte("just text"))
		assert.Equal(t, "just text", result)
	})

	t.Run("[16]byte UUID formatted", func(t *testing.T) {
		uuidBytes := [16]byte{
			0x12, 0x3e, 0x45, 0x67, 0xe8, 0x9b, 0x12, 0xd3,
			0xa4, 0x56, 0x42, 0x66, 0x14, 0x17, 0x40, 0x00,
		}
		result := normalizeValue(uuidBytes)
		assert.Equal(t, "123e4567-e89b-12d3-a456-426614174000", result)
	})

	t.Run("float64 unchanged", func(t *testing.T) {
		assert.Equal(t, 3.14, normalizeValue(3.14))
	})
}

// ── intValue ──

func TestIntValue(t *testing.T) {
	assert.Equal(t, int64(0), intValue(nil))
	assert.Equal(t, int64(42), intValue(42))
	assert.Equal(t, int64(42), intValue(int32(42)))
	assert.Equal(t, int64(42), intValue(int64(42)))
	assert.Equal(t, int64(42), intValue(float64(42.7)))
	assert.Equal(t, int64(42), intValue("42"))
	assert.Equal(t, int64(0), intValue("not-a-number"))
	assert.Equal(t, int64(0), intValue(map[string]any{}))
}

// ── floatValue ──

func TestFloatValue(t *testing.T) {
	assert.Equal(t, float64(0), floatValue(nil))
	assert.InDelta(t, 3.14, floatValue(float32(3.14)), 0.001)
	assert.Equal(t, float64(3.14), floatValue(float64(3.14)))
	assert.Equal(t, float64(42), floatValue(42))
	assert.Equal(t, float64(42), floatValue(int32(42)))
	assert.Equal(t, float64(42), floatValue(int64(42)))
	assert.Equal(t, 2.5, floatValue("2.5"))
	assert.Equal(t, float64(0), floatValue("not-a-number"))
	assert.Equal(t, float64(0), floatValue([]int{1}))
}

// ── boolValue ──

func TestBoolValue(t *testing.T) {
	assert.True(t, boolValue(true))
	assert.False(t, boolValue(false))
	assert.True(t, boolValue(1))
	assert.False(t, boolValue(0))
	assert.True(t, boolValue(int32(1)))
	assert.False(t, boolValue(int32(0)))
	assert.True(t, boolValue(int64(-1)))
	assert.False(t, boolValue(int64(0)))
	assert.True(t, boolValue("true"))
	assert.True(t, boolValue("1"))
	assert.False(t, boolValue("false"))
	assert.False(t, boolValue("0"))
	assert.False(t, boolValue(""))
	assert.False(t, boolValue(nil))
	assert.False(t, boolValue([]int{}))
}

// ── stringValue ──

func TestStringValue(t *testing.T) {
	assert.Equal(t, "", stringValue(nil))
	assert.Equal(t, "hello", stringValue("hello"))
	assert.Equal(t, "42", stringValue(int64(42)))
	assert.Equal(t, "3.14", stringValue(float64(3.14)))

	label := stringLabel("test")
	assert.Equal(t, "test", stringValue(label))
}

type stringLabel string

func (s stringLabel) String() string { return string(s) }

// ── firstNonNil ──

func TestFirstNonNil(t *testing.T) {
	assert.Equal(t, "a", firstNonNil(nil, "a", "b"))
	assert.Equal(t, "a", firstNonNil("a", "b"))
	assert.Nil(t, firstNonNil(nil, nil, nil))
	assert.Nil(t, firstNonNil())
}

// ── firstN ──

func TestFirstN(t *testing.T) {
	assert.Equal(t, "abc", firstN("abcde", 3))
	assert.Equal(t, "ab", firstN("ab", 5))
	assert.Equal(t, "", firstN("", 5))
	assert.Equal(t, "abc", firstN("abc", 3))
}

// ── anyStrings ──

func TestAnyStrings(t *testing.T) {
	values := []any{"a", nil, "  b ", int64(42), "c", ""}
	result := anyStrings(values)
	assert.Equal(t, []string{"a", "b", "42", "c"}, result)
}

func TestAnyStringsEmpty(t *testing.T) {
	assert.Empty(t, anyStrings([]any{}))
}

func TestAnyStringsAllNilOrEmpty(t *testing.T) {
	assert.Empty(t, anyStrings([]any{nil, "", "  "}))
}

// ── avg ──

func TestAvg(t *testing.T) {
	assert.Equal(t, float64(0), avg([]float64{}))
	assert.Equal(t, float64(0), avg(nil))
	assert.Equal(t, float64(5), avg([]float64{5}))
	assert.Equal(t, float64(3), avg([]float64{1, 2, 3, 4, 5}))
	assert.Equal(t, 2.5, avg([]float64{2, 3}))
}

// ── roundFloat ──

func TestRoundFloat(t *testing.T) {
	assert.Equal(t, 3.142, roundFloat(3.14159, 3))
	assert.Equal(t, 3.14, roundFloat(3.14159, 2))
	assert.Equal(t, 3.0, roundFloat(3.14159, 0))
	assert.Equal(t, 3.15, roundFloat(3.145, 2))
	assert.Equal(t, 4.0, roundFloat(3.5, 0))
}

// ── clamp ──

func TestClamp(t *testing.T) {
	assert.Equal(t, 5, clamp(3, 5, 10))
	assert.Equal(t, 10, clamp(15, 5, 10))
	assert.Equal(t, 7, clamp(7, 5, 10))
	assert.Equal(t, 5, clamp(5, 5, 10))
	assert.Equal(t, 10, clamp(10, 5, 10))
}

// ── max ──

func TestMax(t *testing.T) {
	assert.Equal(t, 5, max(3, 5))
	assert.Equal(t, 5, max(5, 3))
	assert.Equal(t, 3, max(3, 3))
	assert.Equal(t, 1, max(1, -1))
}

// ── withReason ──

func TestWithReason(t *testing.T) {
	input := map[string]any{"a": 1, "b": "two"}
	output := withReason(input, "test_reason")

	assert.Equal(t, "test_reason", output["reason"])
	assert.Equal(t, 1, output["a"])
	assert.Equal(t, "two", output["b"])

	assert.NotContains(t, input, "reason")
}

// ── historyFallbackKey ──

func TestHistoryFallbackKey(t *testing.T) {
	assert.Equal(t, "high vis\x00guided tour", historyFallbackKey("High Vis", "Guided Tour"))
	assert.Equal(t, "high vis\x00guided tour", historyFallbackKey("  High Vis  ", "  Guided Tour  "))
}

func TestHistoryFallbackKeyEmpty(t *testing.T) {
	assert.Equal(t, "\x00", historyFallbackKey("", ""))
}

// ── lyricsForTrack ──

func TestLyricsForTrack(t *testing.T) {
	items := map[int64]map[string]any{
		1: {"status": "synced", "found": true},
		2: {"status": "none", "found": false},
	}

	result := lyricsForTrack(items, 1)
	assert.Equal(t, "synced", result["status"])
	assert.Equal(t, true, result["found"])
}

func TestLyricsForTrackMissing(t *testing.T) {
	items := map[int64]map[string]any{
		1: {"status": "synced"},
	}

	result := lyricsForTrack(items, 99)
	assert.Equal(t, "none", result["status"])
	assert.Equal(t, false, result["found"])
}

// ── defaultLyrics ──

func TestDefaultLyrics(t *testing.T) {
	result := defaultLyrics()

	assert.Equal(t, "none", result["status"])
	assert.Equal(t, false, result["found"])
	assert.Equal(t, false, result["has_plain"])
	assert.Equal(t, false, result["has_synced"])
	assert.Equal(t, "lrclib", result["provider"])
	assert.Nil(t, result["updated_at"])
}
