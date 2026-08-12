package httpx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestSingleJoiningSlash(t *testing.T) {
	cases := []struct {
		a    string
		b    string
		want string
	}{
		{"", "/api/auth/me", "/api/auth/me"},
		{"/root", "/api/auth/me", "/root/api/auth/me"},
		{"/root/", "/api/auth/me", "/root/api/auth/me"},
		{"/root", "api/auth/me", "/root/api/auth/me"},
	}
	for _, tt := range cases {
		assert.Equal(t, tt.want, singleJoiningSlash(tt.a, tt.b))
	}
}

func TestFallbackProxyBoundsInteractiveRequests(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(40 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	proxy, err := NewFallbackProxyWithConfig(FallbackConfig{
		Enabled:          true,
		BaseURL:          backend.URL,
		RequestTimeout:   10 * time.Millisecond,
		FailureThreshold: 3,
		OpenDuration:     time.Second,
	})
	assert.NoError(t, err)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/search?q=test", nil)

	assert.True(t, proxy.ServeHTTP(recorder, request))
	assert.Equal(t, http.StatusBadGateway, recorder.Code)
	assert.Equal(t, uint64(1), proxy.Stats().Timeouts)
}

func TestFallbackProxyCircuitOpensAndRecoversHalfOpen(t *testing.T) {
	var calls atomic.Int32
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) <= 2 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	proxy, err := NewFallbackProxyWithConfig(FallbackConfig{
		Enabled:          true,
		BaseURL:          backend.URL,
		RequestTimeout:   time.Second,
		FailureThreshold: 2,
		OpenDuration:     20 * time.Millisecond,
	})
	assert.NoError(t, err)

	for range 2 {
		recorder := httptest.NewRecorder()
		proxy.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/search", nil))
		assert.Equal(t, http.StatusServiceUnavailable, recorder.Code)
	}

	rejected := httptest.NewRecorder()
	proxy.ServeHTTP(rejected, httptest.NewRequest(http.MethodGet, "/api/search", nil))
	assert.Equal(t, http.StatusServiceUnavailable, rejected.Code)
	assert.Equal(t, "1", rejected.Header().Get("Retry-After"))
	assert.Equal(t, int32(2), calls.Load())

	time.Sleep(25 * time.Millisecond)
	recovered := httptest.NewRecorder()
	proxy.ServeHTTP(recovered, httptest.NewRequest(http.MethodGet, "/api/search", nil))
	assert.Equal(t, http.StatusOK, recovered.Code)
	assert.Equal(t, uint64(1), proxy.Stats().Rejected)
}

func TestFallbackProxyDoesNotApplyInteractiveDeadlineToStreams(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(25 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	proxy, err := NewFallbackProxyWithConfig(FallbackConfig{
		Enabled:          true,
		BaseURL:          backend.URL,
		RequestTimeout:   5 * time.Millisecond,
		FailureThreshold: 2,
		OpenDuration:     time.Second,
	})
	assert.NoError(t, err)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/tracks/1/stream", nil)
	proxy.ServeHTTP(recorder, request)

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, uint64(0), proxy.Stats().Timeouts)
}

func TestFallbackProxyArtworkFailuresDoNotOpenInteractiveBreaker(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/photo") {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	proxy, err := NewFallbackProxyWithConfig(FallbackConfig{
		Enabled:          true,
		BaseURL:          backend.URL,
		RequestTimeout:   time.Second,
		FailureThreshold: 1,
		OpenDuration:     time.Second,
	})
	assert.NoError(t, err)

	artwork := httptest.NewRecorder()
	proxy.ServeHTTP(
		artwork,
		httptest.NewRequest(http.MethodGet, "/api/catalog/artists/artist-1/photo", nil),
	)
	assert.Equal(t, http.StatusServiceUnavailable, artwork.Code)

	interactive := httptest.NewRecorder()
	proxy.ServeHTTP(
		interactive,
		httptest.NewRequest(http.MethodGet, "/api/artist-slugs/high-vis/page", nil),
	)
	assert.Equal(t, http.StatusOK, interactive.Code)
}

func TestFallbackProxyUsesIndependentArtworkDeadline(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(25 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	proxy, err := NewFallbackProxyWithConfig(FallbackConfig{
		Enabled:          true,
		BaseURL:          backend.URL,
		RequestTimeout:   5 * time.Millisecond,
		ArtworkTimeout:   100 * time.Millisecond,
		FailureThreshold: 2,
		OpenDuration:     time.Second,
	})
	assert.NoError(t, err)

	recorder := httptest.NewRecorder()
	proxy.ServeHTTP(
		recorder,
		httptest.NewRequest(http.MethodGet, "/api/catalog/albums/album-1/cover", nil),
	)

	assert.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, uint64(0), proxy.Stats().Timeouts)

	heroRecorder := httptest.NewRecorder()
	proxy.ServeHTTP(
		heroRecorder,
		httptest.NewRequest(http.MethodGet, "/api/artists/5/hero?composition=desktop", nil),
	)

	assert.Equal(t, http.StatusOK, heroRecorder.Code)
	assert.Equal(t, uint64(0), proxy.Stats().Timeouts)
}

func TestFallbackProxyBoundsStreamingResponseHeaders(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(30 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	proxy, err := NewFallbackProxyWithConfig(FallbackConfig{
		Enabled:               true,
		BaseURL:               backend.URL,
		RequestTimeout:        time.Second,
		ResponseHeaderTimeout: 5 * time.Millisecond,
		FailureThreshold:      2,
		OpenDuration:          time.Second,
	})
	assert.NoError(t, err)

	recorder := httptest.NewRecorder()
	proxy.ServeHTTP(
		recorder,
		httptest.NewRequest(http.MethodGet, "/api/tracks/1/stream", nil),
	)

	assert.Equal(t, http.StatusBadGateway, recorder.Code)
	assert.Equal(t, uint64(1), proxy.Stats().Timeouts)
}
