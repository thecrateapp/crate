package snapshots

import (
	"container/list"
	"testing"
	"time"
)

func TestDecodePayloadKeepsObjectShape(t *testing.T) {
	payload, err := DecodePayload([]byte(`{"hero":[{"name":"Converge"}]}`))
	if err != nil {
		t.Fatalf("DecodePayload returned error: %v", err)
	}
	if _, ok := payload["hero"]; !ok {
		t.Fatalf("payload = %+v", payload)
	}
}

func TestDecodePayloadWrapsNonObject(t *testing.T) {
	payload, err := DecodePayload([]byte(`["a","b"]`))
	if err != nil {
		t.Fatalf("DecodePayload returned error: %v", err)
	}
	if _, ok := payload["value"]; !ok {
		t.Fatalf("payload = %+v", payload)
	}
}

func TestSnapshotFreshnessAcceptsFreshSnapshot(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	stale, usable := SnapshotFreshness(now.Add(-time.Minute), nil, now, 10*time.Minute, time.Hour)
	if stale || !usable {
		t.Fatalf("stale=%v usable=%v", stale, usable)
	}
}

func TestSnapshotFreshnessAcceptsRecentStaleSnapshot(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	staleAfter := now.Add(-time.Second)
	stale, usable := SnapshotFreshness(now.Add(-20*time.Minute), &staleAfter, now, 10*time.Minute, time.Hour)
	if !stale || !usable {
		t.Fatalf("stale=%v usable=%v", stale, usable)
	}
}

func TestSnapshotFreshnessRejectsTooOldSnapshot(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	stale, usable := SnapshotFreshness(now.Add(-2*time.Hour), nil, now, 10*time.Minute, time.Hour)
	if !stale || usable {
		t.Fatalf("stale=%v usable=%v", stale, usable)
	}
}

func TestSnapshotCacheExpiresAndReturnsCopy(t *testing.T) {
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
	if first == nil {
		t.Fatal("expected cached row")
	}
	first.Payload["title"] = "mutated"

	second := store.cacheGet(key, now.Add(600*time.Millisecond))
	if second == nil {
		t.Fatal("expected cached row")
	}
	if second.Payload["title"] != "Home" {
		t.Fatalf("cached row was mutated: %+v", second.Payload)
	}

	expired := store.cacheGet(key, now.Add(2*time.Second))
	if expired != nil {
		t.Fatalf("expected expired cache entry, got %+v", expired)
	}
}

func TestSnapshotCacheLRUEvictsOldest(t *testing.T) {
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
	// access a so b becomes LRU
	_ = store.cacheGet("a", now)
	store.cacheSet("d", &Row{Payload: map[string]any{"k": "d"}}, now)

	if store.cacheGet("b", now) != nil {
		t.Fatal("expected b to be evicted")
	}
	if store.cacheGet("a", now) == nil {
		t.Fatal("expected a to still be present")
	}
	if store.cacheGet("c", now) == nil {
		t.Fatal("expected c to still be present")
	}
	if store.cacheGet("d", now) == nil {
		t.Fatal("expected d to be present")
	}
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
	if _, ok := originalArtist["album"]; ok {
		t.Fatalf("decorated payload mutated original nested payload: %+v", originalArtist)
	}
}
