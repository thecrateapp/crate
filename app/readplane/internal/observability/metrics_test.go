package observability

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCumulativeOpenLatency(t *testing.T) {
	tests := []struct {
		name       string
		exclusive  map[string]int64
		cumulative []int64
		total      int64
	}{
		{"empty", map[string]int64{}, []int64{0, 0, 0, 0}, 0},
		{"one per bucket", map[string]int64{"le_1": 1, "le_5": 1, "le_20": 1, "le_100": 1, ">100": 1}, []int64{1, 2, 3, 4}, 5},
		{"only slow", map[string]int64{">100": 3}, []int64{0, 0, 0, 0}, 3},
		{"gaps", map[string]int64{"le_1": 2, "le_100": 5}, []int64{2, 2, 2, 7}, 7},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cumulative, total := CumulativeOpenLatency(tt.exclusive)
			assert.Equal(t, tt.cumulative, cumulative)
			assert.Equal(t, tt.total, total)
		})
	}
}

func TestBoundedLabels(t *testing.T) {
	sources := []struct{ header, want string }{
		{"hit", "hit"}, {"miss", "miss"}, {"fallback", "fallback"}, {"", "other"}, {"HIT", "other"},
	}
	for _, tt := range sources {
		assert.Equal(t, tt.want, RouteSource(tt.header), tt.header)
	}
	classes := []struct {
		status int
		want   string
	}{{200, "2xx"}, {206, "2xx"}, {304, "3xx"}, {404, "4xx"}, {503, "5xx"}, {0, "other"}, {600, "other"}}
	for _, tt := range classes {
		assert.Equal(t, tt.want, StatusClass(tt.status), tt.status)
	}
}

func TestWritePrometheus(t *testing.T) {
	requests := NewRequestMetrics()
	requests.Observe("hit", 200, 20*time.Millisecond)
	requests.Observe("hit", 200, 2*time.Second)
	requests.Observe("bogus", 502, time.Millisecond)
	media := NewMediaMetrics()
	media.Start()
	media.Start()
	media.Finish(206, 512, true, "stream")
	media.Finish(404, 0, false, "stream")
	media.RecordFallback(`odd"reason`)
	media.RecordNativeArtwork(true, "")
	media.RecordNativeArtwork(false, "manifest")
	media.RecordOpenLatency(3)
	media.RecordOpenLatency(250)

	var body strings.Builder
	require.NoError(t, WritePrometheus(&body, requests, media))
	text := body.String()

	tests := []struct {
		name string
		line string
	}{
		{"requests by source", `crate_readplane_requests_total{source="hit",status_class="2xx"} 2`},
		{"unknown source", `crate_readplane_requests_total{source="other",status_class="5xx"} 1`},
		{"cumulative request bucket", `crate_readplane_request_duration_seconds_bucket{source="hit",le="0.025"} 1`},
		{"request inf", `crate_readplane_request_duration_seconds_bucket{source="hit",le="+Inf"} 2`},
		{"request count", `crate_readplane_request_duration_seconds_count{source="hit"} 2`},
		{"media by class", `crate_readplane_media_requests_total{status_class="2xx"} 1`},
		{"media bytes", `crate_readplane_media_bytes_total 512`},
		{"active streams", `crate_readplane_media_active_streams 0`},
		{"escaped reason", `crate_readplane_media_fallback_total{reason="odd\"reason"} 1`},
		{"artwork hit", `crate_readplane_artwork_native_total{outcome="hit",reason=""} 1`},
		{"artwork miss", `crate_readplane_artwork_native_total{outcome="miss",reason="manifest"} 1`},
		{"open cumulative", `crate_readplane_media_open_latency_seconds_bucket{le="0.005"} 1`},
		{"open later bound", `crate_readplane_media_open_latency_seconds_bucket{le="0.1"} 1`},
		{"open inf", `crate_readplane_media_open_latency_seconds_bucket{le="+Inf"} 2`},
		{"open sum", `crate_readplane_media_open_latency_seconds_sum 0.253`},
		{"histogram type", `# TYPE crate_readplane_media_open_latency_seconds histogram`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Contains(t, text, tt.line+"\n")
		})
	}
}
