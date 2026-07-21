package observability

import (
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMediaMetricsAreConcurrentAndPrivacySafe(t *testing.T) {
	metrics := NewMediaMetrics()
	var wg sync.WaitGroup
	for range 100 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			metrics.Start()
			metrics.Finish(206, 512, true, "stream")
		}()
	}
	wg.Wait()
	metrics.RecordFallback("missing_variant")
	metrics.RecordNativeArtwork(false, "manifest")
	metrics.RecordOpenLatency(3)

	snapshot := metrics.Snapshot()
	assert.Equal(t, int64(100), snapshot.Requests["206"])
	assert.Equal(t, int64(0), snapshot.ActiveStreams)
	assert.Equal(t, int64(51200), snapshot.Bytes)
	assert.Equal(t, int64(100), snapshot.RangeRequests)
	assert.Equal(t, int64(1), snapshot.Fallbacks["missing_variant"])
	assert.Equal(t, int64(1), snapshot.ArtworkMisses["manifest"])
	assert.Equal(t, int64(1), snapshot.OpenLatency["le_5"])
}
