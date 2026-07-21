package observability

import (
	"strconv"
	"sync"
	"sync/atomic"
)

type MediaSnapshot struct {
	Requests      map[string]int64 `json:"local_media_requests_total"`
	ActiveStreams int64            `json:"local_media_active_streams"`
	Bytes         int64            `json:"local_media_bytes_total"`
	RangeRequests int64            `json:"local_media_range_requests_total"`
	Fallbacks     map[string]int64 `json:"local_media_fallback_total"`
	ArtworkHits   int64            `json:"artwork_native_hits_total"`
	ArtworkMisses map[string]int64 `json:"artwork_native_misses_total"`
	OpenLatency   map[string]int64 `json:"local_media_open_latency_ms"`
}

type MediaMetrics struct {
	active        atomic.Int64
	bytes         atomic.Int64
	ranges        atomic.Int64
	artworkHits   atomic.Int64
	mu            sync.Mutex
	requests      map[string]int64
	fallbacks     map[string]int64
	artworkMisses map[string]int64
	openLatency   map[string]int64
}

func NewMediaMetrics() *MediaMetrics {
	return &MediaMetrics{requests: map[string]int64{}, fallbacks: map[string]int64{}, artworkMisses: map[string]int64{}, openLatency: map[string]int64{}}
}

func (m *MediaMetrics) Start() { m.active.Add(1) }
func (m *MediaMetrics) Finish(status int, bytes int64, ranged bool, _ string) {
	m.active.Add(-1)
	m.bytes.Add(bytes)
	if ranged {
		m.ranges.Add(1)
	}
	m.mu.Lock()
	m.requests[strconv.Itoa(status)]++
	m.mu.Unlock()
}
func (m *MediaMetrics) RecordFallback(reason string) {
	m.mu.Lock()
	m.fallbacks[reason]++
	m.mu.Unlock()
}
func (m *MediaMetrics) RecordOpenLatency(milliseconds float64) {
	bucket := ">100"
	for _, limit := range []int{1, 5, 20, 100} {
		if milliseconds <= float64(limit) {
			bucket = "le_" + strconv.Itoa(limit)
			break
		}
	}
	m.mu.Lock()
	m.openLatency[bucket]++
	m.mu.Unlock()
}
func (m *MediaMetrics) RecordNativeArtwork(hit bool, reason string) {
	if hit {
		m.artworkHits.Add(1)
		return
	}
	m.mu.Lock()
	m.artworkMisses[reason]++
	m.mu.Unlock()
}
func (m *MediaMetrics) Snapshot() MediaSnapshot {
	m.mu.Lock()
	requests := clone(m.requests)
	fallbacks := clone(m.fallbacks)
	misses := clone(m.artworkMisses)
	openLatency := clone(m.openLatency)
	m.mu.Unlock()
	return MediaSnapshot{Requests: requests, ActiveStreams: m.active.Load(), Bytes: m.bytes.Load(), RangeRequests: m.ranges.Load(), Fallbacks: fallbacks, ArtworkHits: m.artworkHits.Load(), ArtworkMisses: misses, OpenLatency: openLatency}
}
func clone(source map[string]int64) map[string]int64 {
	result := make(map[string]int64, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}
