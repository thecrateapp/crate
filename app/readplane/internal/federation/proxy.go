package federation

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const streamBufferSize = 64 * 1024

var safeResponseHeaders = map[string]struct{}{
	"accept-ranges": {}, "cache-control": {}, "content-length": {},
	"content-range": {}, "content-type": {}, "etag": {}, "last-modified": {},
}

var safeAuthorizationHeaders = map[string]struct{}{
	"accept": {}, "host": {}, "if-range": {}, "range": {},
	"x-crate-body-sha256": {}, "x-crate-key-id": {}, "x-crate-node-id": {},
	"x-crate-nonce": {}, "x-crate-playback-session": {}, "x-crate-signature": {},
	"x-crate-signature-version": {}, "x-crate-signed-headers": {}, "x-crate-timestamp": {},
}

// FallbackFunc proxies the original request to FastAPI and reports whether it handled it.
type FallbackFunc func(http.ResponseWriter, *http.Request) bool

// RevocationChecker reports whether an active local relay ticket was revoked.
type RevocationChecker func(context.Context, string) bool

// ProxyConfig controls the bounded stream transport.
type ProxyConfig struct {
	AllowPrivateNetworks  bool
	ConnectTimeout        time.Duration
	ResponseHeaderTimeout time.Duration
}

// Proxy relays a federated media response without buffering the full object.
type Proxy struct {
	config    ProxyConfig
	signer    Signer
	fallback  FallbackFunc
	revoked   RevocationChecker
	transport *http.Transport
}

// NewProxy creates a federation stream data-plane proxy.
func NewProxy(config ProxyConfig, signer Signer, fallback FallbackFunc, revoked RevocationChecker) *Proxy {
	if config.ConnectTimeout <= 0 {
		config.ConnectTimeout = 5 * time.Second
	}
	if config.ResponseHeaderTimeout <= 0 {
		config.ResponseHeaderTimeout = 10 * time.Second
	}
	dialer := &net.Dialer{Timeout: config.ConnectTimeout, KeepAlive: 30 * time.Second}
	return &Proxy{
		config:   config,
		signer:   signer,
		fallback: fallback,
		revoked:  revoked,
		transport: &http.Transport{
			Proxy:                 nil,
			DialContext:           dialer.DialContext,
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          100,
			MaxIdleConnsPerHost:   50,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   config.ConnectTimeout,
			ResponseHeaderTimeout: config.ResponseHeaderTimeout,
		},
	}
}

// ServeHTTP authenticates one local ticket through the control plane and streams its peer response.
func (p *Proxy) ServeHTTP(w http.ResponseWriter, request *http.Request, localUserID int64, ticketUID string) {
	if p == nil || p.signer == nil {
		http.Error(w, "Federation stream proxy unavailable", http.StatusServiceUnavailable)
		return
	}
	if request.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	authorization, err := p.signer.Authorize(request.Context(), AuthorizationRequest{
		TicketUID:   ticketUID,
		LocalUserID: localUserID,
		Method:      http.MethodGet,
		RequestPath: request.URL.Path,
		Audience:    "crate-readplane",
		Range:       request.Header.Get("Range"),
		IfRange:     request.Header.Get("If-Range"),
		Accept:      request.Header.Get("Accept"),
	})
	if err != nil {
		var denied *AuthorizationError
		if errors.As(err, &denied) {
			status := denied.StatusCode
			if status < 400 || status >= 500 {
				status = http.StatusBadGateway
			}
			http.Error(w, http.StatusText(status), status)
			return
		}
		if p.fallback != nil && p.fallback(w, request) {
			return
		}
		http.Error(w, "Federation control plane unavailable", http.StatusBadGateway)
		return
	}
	if err := p.validateAuthorization(authorization, request.URL.Path, ticketUID, time.Now()); err != nil {
		http.Error(w, "Invalid federation stream authorization", http.StatusBadGateway)
		return
	}

	upstreamRequest, err := http.NewRequestWithContext(
		request.Context(), http.MethodGet, authorization.ConnectionURL, nil,
	)
	if err != nil {
		http.Error(w, "Invalid federation stream destination", http.StatusBadGateway)
		return
	}
	for name, value := range authorization.SignedHeaders {
		if strings.EqualFold(name, "Host") {
			continue
		}
		upstreamRequest.Header.Set(name, value)
	}
	upstreamRequest.Host = authorization.HostHeader

	transport := p.transport.Clone()
	if strings.HasPrefix(strings.ToLower(authorization.ConnectionURL), "https://") {
		transport.TLSClientConfig = &tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: authorization.SNIHostname,
		}
	}
	client := &http.Client{
		Transport: transport,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Do(upstreamRequest)
	if err != nil {
		http.Error(w, "Remote federation stream unavailable", http.StatusBadGateway)
		return
	}
	defer response.Body.Close()

	copyResponseHeaders(w.Header(), response.Header)
	w.WriteHeader(response.StatusCode)
	if request.Method == http.MethodHead {
		return
	}
	reader := io.Reader(response.Body)
	if p.revoked != nil {
		reader = &revocationReader{
			ctx:       request.Context(),
			reader:    response.Body,
			ticketUID: ticketUID,
			check:     p.revoked,
		}
	}
	buffer := make([]byte, streamBufferSize)
	_, _ = io.CopyBuffer(w, reader, buffer)
}

func (p *Proxy) validateAuthorization(auth Authorization, requestPath, ticketUID string, now time.Time) error {
	if auth.AuthorizationUID == "" || auth.TicketUID != ticketUID {
		return errors.New("authorization identity mismatch")
	}
	if auth.Audience != "crate-readplane" || auth.Method != http.MethodGet || auth.RequestPath != requestPath {
		return errors.New("authorization binding mismatch")
	}
	if !auth.ExpiresAt.After(now) || auth.ExpiresAt.After(now.Add(30*time.Second)) {
		return errors.New("authorization lifetime invalid")
	}
	external, err := url.Parse(auth.ExternalURL)
	if err != nil || external.Scheme == "" || external.Host == "" || external.User != nil || external.Fragment != "" {
		return errors.New("external URL invalid")
	}
	connection, err := url.Parse(auth.ConnectionURL)
	if err != nil || connection.Scheme == "" || connection.Host == "" || connection.User != nil || connection.Fragment != "" {
		return errors.New("connection URL invalid")
	}
	if external.Scheme != connection.Scheme || external.EscapedPath() != connection.EscapedPath() || external.RawQuery != connection.RawQuery {
		return errors.New("connection URL changed resource")
	}
	if !strings.EqualFold(external.Host, auth.HostHeader) {
		return errors.New("host binding mismatch")
	}
	ip := net.ParseIP(connection.Hostname())
	if ip == nil {
		return errors.New("connection URL must pin a literal IP")
	}
	if !p.config.AllowPrivateNetworks && !isPublicIP(ip) {
		return errors.New("connection URL points to a non-public IP")
	}
	if external.Scheme == "https" && !strings.EqualFold(external.Hostname(), auth.SNIHostname) {
		return errors.New("SNI binding mismatch")
	}
	for name, value := range auth.SignedHeaders {
		normalized := strings.ToLower(strings.TrimSpace(name))
		if _, ok := safeAuthorizationHeaders[normalized]; !ok || strings.ContainsAny(value, "\r\n") {
			return fmt.Errorf("unsafe authorization header %q", name)
		}
		if normalized == "host" && !strings.EqualFold(value, auth.HostHeader) {
			return errors.New("signed host mismatch")
		}
	}
	return nil
}

func isPublicIP(ip net.IP) bool {
	return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast()
}

func copyResponseHeaders(destination, source http.Header) {
	for name, values := range source {
		if _, ok := safeResponseHeaders[strings.ToLower(name)]; !ok {
			continue
		}
		for _, value := range values {
			if !strings.ContainsAny(value, "\r\n") {
				destination.Add(name, value)
			}
		}
	}
	destination.Set("Cache-Control", "private, no-store")
}

type revocationReader struct {
	ctx       context.Context
	reader    io.Reader
	ticketUID string
	check     RevocationChecker
}

func (r *revocationReader) Read(buffer []byte) (int, error) {
	if r.check(r.ctx, r.ticketUID) {
		return 0, errors.New("federation stream revoked")
	}
	return r.reader.Read(buffer)
}
