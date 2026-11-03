package observability

import (
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var requestBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

var openLatencyBuckets = []struct {
	key   string
	bound float64
}{{"le_1", 0.001}, {"le_5", 0.005}, {"le_20", 0.02}, {"le_100", 0.1}}

type requestKey struct {
	source      string
	statusClass string
}

type histogram struct {
	buckets []int64
	count   int64
	sum     float64
}

// RequestMetrics counts readplane responses by source and status class.
type RequestMetrics struct {
	mu        sync.Mutex
	counts    map[requestKey]int64
	durations map[string]*histogram
}

func NewRequestMetrics() *RequestMetrics {
	return &RequestMetrics{counts: map[requestKey]int64{}, durations: map[string]*histogram{}}
}

// RouteSource bounds the X-Crate-Readplane header to the values the server sets.
func RouteSource(header string) string {
	switch header {
	case "hit", "miss", "fallback":
		return header
	default:
		return "other"
	}
}

func StatusClass(status int) string {
	if status < 100 || status > 599 {
		return "other"
	}
	return strconv.Itoa(status/100) + "xx"
}

func (m *RequestMetrics) Observe(source string, status int, elapsed time.Duration) {
	source = RouteSource(source)
	seconds := elapsed.Seconds()
	m.mu.Lock()
	defer m.mu.Unlock()
	m.counts[requestKey{source, StatusClass(status)}]++
	h := m.durations[source]
	if h == nil {
		h = &histogram{buckets: make([]int64, len(requestBuckets))}
		m.durations[source] = h
	}
	for i, bound := range requestBuckets {
		if seconds <= bound {
			h.buckets[i]++
		}
	}
	h.count++
	h.sum += seconds
}

// CumulativeOpenLatency converts the exclusive open-latency buckets to Prometheus
// cumulative buckets, returning one count per bound plus the total for +Inf.
func CumulativeOpenLatency(exclusive map[string]int64) ([]int64, int64) {
	cumulative := make([]int64, len(openLatencyBuckets))
	var running int64
	for i, bucket := range openLatencyBuckets {
		running += exclusive[bucket.key]
		cumulative[i] = running
	}
	return cumulative, running + exclusive[">100"]
}

// WritePrometheus renders request and media metrics in the Prometheus text format.
func WritePrometheus(w io.Writer, requests *RequestMetrics, media *MediaMetrics) error {
	out := &promWriter{w: w}
	if requests != nil {
		requests.write(out)
	}
	if media != nil {
		media.write(out)
	}
	return out.err
}

func (m *RequestMetrics) write(out *promWriter) {
	m.mu.Lock()
	counts := make(map[requestKey]int64, len(m.counts))
	for key, value := range m.counts {
		counts[key] = value
	}
	durations := make(map[string]histogram, len(m.durations))
	for source, h := range m.durations {
		durations[source] = histogram{buckets: append([]int64(nil), h.buckets...), count: h.count, sum: h.sum}
	}
	m.mu.Unlock()

	out.header("crate_readplane_requests_total", "counter", "Readplane responses by source and status class")
	keys := make([]requestKey, 0, len(counts))
	for key := range counts {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].source != keys[j].source {
			return keys[i].source < keys[j].source
		}
		return keys[i].statusClass < keys[j].statusClass
	})
	for _, key := range keys {
		out.sample("crate_readplane_requests_total", labels("source", key.source, "status_class", key.statusClass), float64(counts[key]))
	}

	out.header("crate_readplane_request_duration_seconds", "histogram", "Readplane response time by source")
	for _, source := range sortedKeys(durations) {
		h := durations[source]
		out.histogram("crate_readplane_request_duration_seconds", "source", source, requestBuckets, h.buckets, h.count, h.sum)
	}
}

func (m *MediaMetrics) write(out *promWriter) {
	m.mu.Lock()
	requests := clone(m.requests)
	fallbacks := clone(m.fallbacks)
	misses := clone(m.artworkMisses)
	openLatency := clone(m.openLatency)
	openSeconds := m.openSeconds
	m.mu.Unlock()

	byClass := map[string]int64{}
	for status, count := range requests {
		code, err := strconv.Atoi(status)
		if err != nil {
			code = 0
		}
		byClass[StatusClass(code)] += count
	}
	out.header("crate_readplane_media_requests_total", "counter", "Local media responses by status class")
	for _, class := range sortedKeys(byClass) {
		out.sample("crate_readplane_media_requests_total", labels("status_class", class), float64(byClass[class]))
	}
	out.header("crate_readplane_media_bytes_total", "counter", "Local media bytes sent")
	out.sample("crate_readplane_media_bytes_total", "", float64(m.bytes.Load()))
	out.header("crate_readplane_media_range_requests_total", "counter", "Local media range requests")
	out.sample("crate_readplane_media_range_requests_total", "", float64(m.ranges.Load()))
	out.header("crate_readplane_media_active_streams", "gauge", "Local media streams in progress")
	out.sample("crate_readplane_media_active_streams", "", float64(m.active.Load()))
	out.header("crate_readplane_media_fallback_total", "counter", "Local media requests handed to the API by reason")
	for _, reason := range sortedKeys(fallbacks) {
		out.sample("crate_readplane_media_fallback_total", labels("reason", reason), float64(fallbacks[reason]))
	}
	out.header("crate_readplane_artwork_native_total", "counter", "Native artwork lookups by outcome")
	out.sample("crate_readplane_artwork_native_total", labels("outcome", "hit", "reason", ""), float64(m.artworkHits.Load()))
	for _, reason := range sortedKeys(misses) {
		out.sample("crate_readplane_artwork_native_total", labels("outcome", "miss", "reason", reason), float64(misses[reason]))
	}

	cumulative, total := CumulativeOpenLatency(openLatency)
	bounds := make([]float64, len(openLatencyBuckets))
	for i, bucket := range openLatencyBuckets {
		bounds[i] = bucket.bound
	}
	out.header("crate_readplane_media_open_latency_seconds", "histogram", "Time to open a local media file")
	out.histogram("crate_readplane_media_open_latency_seconds", "", "", bounds, cumulative, total, openSeconds)
}

type promWriter struct {
	w   io.Writer
	err error
}

func (p *promWriter) printf(format string, args ...any) {
	if p.err == nil {
		_, p.err = fmt.Fprintf(p.w, format, args...)
	}
}

func (p *promWriter) header(name, kind, help string) {
	p.printf("# HELP %s %s\n# TYPE %s %s\n", name, help, name, kind)
}

func (p *promWriter) sample(name, labelText string, value float64) {
	p.printf("%s%s %s\n", name, labelText, strconv.FormatFloat(value, 'g', -1, 64))
}

func (p *promWriter) histogram(name, labelName, labelValue string, bounds []float64, cumulative []int64, count int64, sum float64) {
	base := []string{}
	if labelName != "" {
		base = append(base, labelName, labelValue)
	}
	for i, bound := range bounds {
		p.sample(name+"_bucket", labels(append(base, "le", strconv.FormatFloat(bound, 'g', -1, 64))...), float64(cumulative[i]))
	}
	p.sample(name+"_bucket", labels(append(base, "le", "+Inf")...), float64(count))
	p.sample(name+"_sum", labels(base...), sum)
	p.sample(name+"_count", labels(base...), float64(count))
}

var labelEscaper = strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`)

func labels(pairs ...string) string {
	if len(pairs) == 0 {
		return ""
	}
	parts := make([]string, 0, len(pairs)/2)
	for i := 0; i+1 < len(pairs); i += 2 {
		parts = append(parts, pairs[i]+`="`+labelEscaper.Replace(pairs[i+1])+`"`)
	}
	return "{" + strings.Join(parts, ",") + "}"
}

func sortedKeys[V any](source map[string]V) []string {
	keys := make([]string, 0, len(source))
	for key := range source {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
