package snapshots

import (
	"container/list"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestDecodePayload(t *testing.T) {
	t.Run("keeps object shape", func(t *testing.T) {
		payload, err := DecodePayload([]byte(`{"hero":[{"name":"Converge"}]}`))
		assert.NoError(t, err)
		_, ok := payload["hero"]
		assert.True(t, ok, "payload = %+v", payload)
	})

	t.Run("wraps non-object in value key", func(t *testing.T) {
		payload, err := DecodePayload([]byte(`["a","b"]`))
		assert.NoError(t, err)
		_, ok := payload["value"]
		assert.True(t, ok, "payload = %+v", payload)
	})
}

func TestSnapshotFreshness(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	t.Run("accepts fresh snapshot", func(t *testing.T) {
		stale, usable := SnapshotFreshness(now.Add(-time.Minute), nil, now, 10*time.Minute, time.Hour)
		assert.False(t, stale)
		assert.True(t, usable)
	})

	t.Run("accepts recent stale snapshot", func(t *testing.T) {
		staleAfter := now.Add(-time.Second)
		stale, usable := SnapshotFreshness(now.Add(-20*time.Minute), &staleAfter, now, 10*time.Minute, time.Hour)
		assert.True(t, stale)
		assert.True(t, usable)
	})

	t.Run("rejects too old snapshot", func(t *testing.T) {
		stale, usable := SnapshotFreshness(now.Add(-2*time.Hour), nil, now, 10*time.Minute, time.Hour)
		assert.True(t, stale)
		assert.False(t, usable)
	})
}

func TestSnapshotCache(t *testing.T) {
	t.Run("expires and returns copy", func(t *testing.T) {
		now := time.Unix(1_700_000_000, 0)
		store := &Store{
			cacheTTL:        time.Second,
			cacheMaxEntries: 1000,
			cache:           make(map[string]*list.Element),
			cacheList:       list.New(),
		}
		key := cacheKey("home:discovery", "7")
		store.cacheSet(key, &Row{Payload: map[string]any{"title": "Home"}}, now)

		first := store.cacheGet(key, now.Add(500*time.Millisecond))
		assert.NotNil(t, first, "expected cached row")
		first.Payload["title"] = "mutated"

		second := store.cacheGet(key, now.Add(600*time.Millisecond))
		assert.NotNil(t, second, "expected cached row")
		assert.Equal(t, "Home", second.Payload["title"])

		expired := store.cacheGet(key, now.Add(2*time.Second))
		assert.Nil(t, expired, "expected expired cache entry, got %+v", expired)
	})

	t.Run("LRU evicts oldest", func(t *testing.T) {
		now := time.Unix(1_700_000_000, 0)
		store := &Store{
			cacheTTL:        time.Hour,
			cacheMaxEntries: 3,
			cache:           make(map[string]*list.Element),
			cacheList:       list.New(),
		}

		store.cacheSet("a", &Row{Payload: map[string]any{"k": "a"}}, now)
		store.cacheSet("b", &Row{Payload: map[string]any{"k": "b"}}, now)
		store.cacheSet("c", &Row{Payload: map[string]any{"k": "c"}}, now)
		_ = store.cacheGet("a", now)
		store.cacheSet("d", &Row{Payload: map[string]any{"k": "d"}}, now)

		assert.Nil(t, store.cacheGet("b", now), "expected b to be evicted")
		assert.NotNil(t, store.cacheGet("a", now), "expected a to still be present")
		assert.NotNil(t, store.cacheGet("c", now), "expected c to still be present")
		assert.NotNil(t, store.cacheGet("d", now), "expected d to be present")
	})
}

func TestDecoratedPayloadDoesNotMutateNestedSnapshotPayload(t *testing.T) {
	row := Row{Payload: map[string]any{
		"custom_mixes": []any{
			map[string]any{
				"artwork_artists": []any{
					map[string]any{"artist": "Converge"},
				},
			},
		},
	}}

	decorated := row.DecoratedPayload()
	mix := decorated["custom_mixes"].([]any)[0].(map[string]any)
	artist := mix["artwork_artists"].([]any)[0].(map[string]any)
	artist["album"] = nil

	originalMix := row.Payload["custom_mixes"].([]any)[0].(map[string]any)
	originalArtist := originalMix["artwork_artists"].([]any)[0].(map[string]any)
	_, ok := originalArtist["album"]
	assert.False(t, ok, "decorated payload mutated original nested payload: %+v", originalArtist)
}
