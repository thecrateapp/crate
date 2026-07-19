package httpx

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	defaultFallbackTimeout          = 3 * time.Second
	defaultArtworkFallbackTimeout   = 15 * time.Second
	defaultResponseHeaderTimeout    = 10 * time.Second
	defaultFallbackFailureThreshold = 5
	defaultFallbackOpenDuration     = 10 * time.Second
)

type fallbackRouteClass uint8

const (
	fallbackInteractive fallbackRouteClass = iota
	fallbackArtwork
	fallbackStreaming
)

// FallbackConfig controls the bounded FastAPI compatibility fallback.
type FallbackConfig struct {
	Enabled               bool
	BaseURL               string
	Version               string
	RequestTimeout        time.Duration
	ArtworkTimeout        time.Duration
	ResponseHeaderTimeout time.Duration
	FailureThreshold      int
	OpenDuration          time.Duration
}

// FallbackStats is a point-in-time snapshot of fallback outcomes.
type FallbackStats struct {
	Attempts  uint64
	Successes uint64
	Failures  uint64
	Timeouts  uint64
	Rejected  uint64
}

// FallbackProxy forwards unmatched requests to the FastAPI backend.
type FallbackProxy struct {
	enabled               bool
	target                *url.URL
	version               string
	requestTimeout        time.Duration
	artworkTimeout        time.Duration
	responseHeaderTimeout time.Duration
	proxy                 *httputil.ReverseProxy
	breakers              map[fallbackRouteClass]*fallbackCircuitBreaker
	attempts              atomic.Uint64
	successes             atomic.Uint64
	failures              atomic.Uint64
	timeouts              atomic.Uint64
	rejected              atomic.Uint64
}

// NewFallbackProxy creates a reverse-proxy fallback to the given base URL.
func NewFallbackProxy(enabled bool, baseURL string, version string) (*FallbackProxy, error) {
	return NewFallbackProxyWithConfig(FallbackConfig{
		Enabled:               enabled,
		BaseURL:               baseURL,
		Version:               version,
		RequestTimeout:        defaultFallbackTimeout,
		ArtworkTimeout:        defaultArtworkFallbackTimeout,
		ResponseHeaderTimeout: defaultResponseHeaderTimeout,
		FailureThreshold:      defaultFallbackFailureThreshold,
		OpenDuration:          defaultFallbackOpenDuration,
	})
}

// NewFallbackProxyWithConfig creates one reusable proxy, transport, and circuit breaker.
func NewFallbackProxyWithConfig(cfg FallbackConfig) (*FallbackProxy, error) {
	baseURL := strings.TrimSpace(cfg.BaseURL)
	if !cfg.Enabled {
		return &FallbackProxy{enabled: false, version: cfg.Version}, nil
	}
	if baseURL == "" {
		return nil, errors.New("fallback base url is required")
	}
	target, err := url.Parse(baseURL)
	if err != nil {
		return nil, err
	}
	if cfg.RequestTimeout <= 0 {
		cfg.RequestTimeout = defaultFallbackTimeout
	}
	if cfg.ArtworkTimeout <= 0 {
		cfg.ArtworkTimeout = defaultArtworkFallbackTimeout
	}
	if cfg.ResponseHeaderTimeout <= 0 {
		cfg.ResponseHeaderTimeout = defaultResponseHeaderTimeout
	}
	if cfg.FailureThreshold <= 0 {
		cfg.FailureThreshold = defaultFallbackFailureThreshold
	}
	if cfg.OpenDuration <= 0 {
		cfg.OpenDuration = defaultFallbackOpenDuration
	}

	p := &FallbackProxy{
		enabled:               true,
		target:                target,
		version:               cfg.Version,
		requestTimeout:        cfg.RequestTimeout,
		artworkTimeout:        cfg.ArtworkTimeout,
		responseHeaderTimeout: cfg.ResponseHeaderTimeout,
		breakers: map[fallbackRouteClass]*fallbackCircuitBreaker{
			fallbackInteractive: newFallbackCircuitBreaker(cfg.FailureThreshold, cfg.OpenDuration),
			fallbackArtwork:     newFallbackCircuitBreaker(cfg.FailureThreshold, cfg.OpenDuration),
			fallbackStreaming:   newFallbackCircuitBreaker(cfg.FailureThreshold, cfg.OpenDuration),
		},
	}
	p.proxy = p.newReverseProxy()
	return p, nil
}

// Enabled reports whether the fallback proxy is configured and active.
func (p *FallbackProxy) Enabled() bool {
	return p != nil && p.enabled && p.target != nil
}

// ServeHTTP proxies the request when enabled and returns true if it handled the response.
func (p *FallbackProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) bool {
	if !p.Enabled() {
		return false
	}
	routeClass := classifyFallbackRoute(r)
	breaker := p.breakers[routeClass]
	if !breaker.allow() {
		p.rejected.Add(1)
		MarkReadplane(w, "miss")
		MarkVersion(w, p.version)
		w.Header().Set("Retry-After", "1")
		WriteError(w, http.StatusServiceUnavailable, "Readplane fallback temporarily unavailable")
		return true
	}

	p.attempts.Add(1)
	request := r
	if routeClass != fallbackStreaming {
		timeout := p.requestTimeout
		if routeClass == fallbackArtwork {
			timeout = p.artworkTimeout
		}
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		request = r.WithContext(ctx)
	}
	p.proxy.ServeHTTP(w, request)
	return true
}

// Stats returns low-cardinality fallback counters for observability.
func (p *FallbackProxy) Stats() FallbackStats {
	if p == nil {
		return FallbackStats{}
	}
	return FallbackStats{
		Attempts:  p.attempts.Load(),
		Successes: p.successes.Load(),
		Failures:  p.failures.Load(),
		Timeouts:  p.timeouts.Load(),
		Rejected:  p.rejected.Load(),
	}
}

func (p *FallbackProxy) newReverseProxy() *httputil.ReverseProxy {
	proxy := httputil.NewSingleHostReverseProxy(p.target)
	baseDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		baseDirector(req)
		req.Host = p.target.Host
		req.Header.Set("X-Crate-Readplane-Fallback", "1")
	}
	proxy.Transport = &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          64,
		MaxIdleConnsPerHost:   32,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   3 * time.Second,
		ResponseHeaderTimeout: p.responseHeaderTimeout,
		ExpectContinueTimeout: time.Second,
	}
	proxy.ModifyResponse = func(resp *http.Response) error {
		resp.Header.Set("X-Crate-Readplane", "fallback")
		if p.version != "" {
			resp.Header.Set("X-Crate-Readplane-Version", p.version)
		}
		if resp.StatusCode >= http.StatusInternalServerError {
			p.recordFailure(classifyFallbackRoute(resp.Request))
		} else {
			p.successes.Add(1)
			p.breakers[classifyFallbackRoute(resp.Request)].success()
		}
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, request *http.Request, err error) {
		if isTimeoutError(err) || errors.Is(request.Context().Err(), context.DeadlineExceeded) {
			p.timeouts.Add(1)
		}
		p.recordFailure(classifyFallbackRoute(request))
		MarkReadplane(w, "miss")
		MarkVersion(w, p.version)
		WriteError(w, http.StatusBadGateway, "Readplane fallback failed")
	}
	return proxy
}

func (p *FallbackProxy) recordFailure(routeClass fallbackRouteClass) {
	p.failures.Add(1)
	p.breakers[routeClass].failure()
}

func isTimeoutError(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	var timeoutError interface{ Timeout() bool }
	return errors.As(err, &timeoutError) && timeoutError.Timeout()
}

func classifyFallbackRoute(r *http.Request) fallbackRouteClass {
	if isStreamingFallback(r) {
		return fallbackStreaming
	}
	path := strings.ToLower(r.URL.Path)
	if strings.HasSuffix(path, "/photo") ||
		strings.HasSuffix(path, "/background") ||
		strings.HasSuffix(path, "/cover") ||
		strings.HasSuffix(path, "/avatar") ||
		strings.HasSuffix(path, "/artwork") {
		return fallbackArtwork
	}
	return fallbackInteractive
}

func isStreamingFallback(r *http.Request) bool {
	path := r.URL.Path
	return r.Header.Get("Range") != "" ||
		strings.HasPrefix(path, "/api/federation/remote/streams/") ||
		strings.HasSuffix(path, "/stream") ||
		strings.HasSuffix(path, "/download") ||
		strings.HasSuffix(path, "-stream") ||
		strings.HasSuffix(path, "/events")
}

type fallbackCircuitBreaker struct {
	mu                sync.Mutex
	failureThreshold  int
	openDuration      time.Duration
	consecutiveErrors int
	openUntil         time.Time
	halfOpen          bool
}

func newFallbackCircuitBreaker(failureThreshold int, openDuration time.Duration) *fallbackCircuitBreaker {
	return &fallbackCircuitBreaker{
		failureThreshold: failureThreshold,
		openDuration:     openDuration,
	}
}

func (b *fallbackCircuitBreaker) allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.openUntil.IsZero() {
		return true
	}
	if time.Now().Before(b.openUntil) || b.halfOpen {
		return false
	}
	b.halfOpen = true
	return true
}

func (b *fallbackCircuitBreaker) success() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.consecutiveErrors = 0
	b.openUntil = time.Time{}
	b.halfOpen = false
}

func (b *fallbackCircuitBreaker) failure() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.consecutiveErrors++
	if b.halfOpen || b.consecutiveErrors >= b.failureThreshold {
		b.openUntil = time.Now().Add(b.openDuration)
		b.halfOpen = false
	}
}

func singleJoiningSlash(a string, b string) string {
	aslash := strings.HasSuffix(a, "/")
	bslash := strings.HasPrefix(b, "/")
	switch {
	case aslash && bslash:
		return a + b[1:]
	case !aslash && !bslash:
		return a + "/" + b
	default:
		return a + b
	}
}
