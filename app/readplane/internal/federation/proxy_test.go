package federation

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testTicketUID = "11111111-1111-4111-8111-111111111111"

type staticSigner struct {
	authorization Authorization
	err           error
	requests      []AuthorizationRequest
}

func (s *staticSigner) Authorize(_ context.Context, request AuthorizationRequest) (Authorization, error) {
	s.requests = append(s.requests, request)
	if request.Range != "" {
		s.authorization.SignedHeaders["Range"] = request.Range
	}
	if request.IfRange != "" {
		s.authorization.SignedHeaders["If-Range"] = request.IfRange
	}
	if request.Accept != "" {
		s.authorization.SignedHeaders["Accept"] = request.Accept
	}
	return s.authorization, s.err
}

func authorizationFor(server *httptest.Server) Authorization {
	return Authorization{
		AuthorizationUID: "22222222-2222-4222-8222-222222222222",
		TicketUID:        testTicketUID,
		Audience:         "crate-readplane",
		Method:           http.MethodGet,
		RequestPath:      "/api/federation/remote/streams/" + testTicketUID,
		ExternalURL:      server.URL + "/api/federation/v1/streams/remote-ticket",
		ConnectionURL:    server.URL + "/api/federation/v1/streams/remote-ticket",
		HostHeader:       strings.TrimPrefix(server.URL, "http://"),
		SNIHostname:      "127.0.0.1",
		SignedHeaders: map[string]string{
			"X-Crate-Node-Id":   "node-a",
			"X-Crate-Signature": "ed25519:test",
		},
		ExpiresAt: time.Now().Add(15 * time.Second),
	}
}

func TestProxyStreamsFullAndRangeRequests(t *testing.T) {
	payload := strings.Repeat("crate", 4096)
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "ed25519:test", r.Header.Get("X-Crate-Signature"))
		w.Header().Set("Content-Type", "audio/flac")
		w.Header().Set("Accept-Ranges", "bytes")
		if r.Header.Get("Range") != "" {
			w.Header().Set("Content-Range", "bytes 0-4/20480")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = io.WriteString(w, payload[:5])
			return
		}
		_, _ = io.WriteString(w, payload)
	}))
	defer origin.Close()

	for _, tc := range []struct {
		name       string
		rangeValue string
		status     int
		body       string
	}{
		{name: "full", status: http.StatusOK, body: payload},
		{name: "range", rangeValue: "bytes=0-4", status: http.StatusPartialContent, body: payload[:5]},
	} {
		t.Run(tc.name, func(t *testing.T) {
			signer := &staticSigner{authorization: authorizationFor(origin)}
			proxy := NewProxy(ProxyConfig{AllowPrivateNetworks: true}, signer, nil, nil)
			req := httptest.NewRequest(http.MethodGet, "/api/federation/remote/streams/"+testTicketUID, nil)
			req.Header.Set("Range", tc.rangeValue)
			req.Header.Set("Cookie", "must-not-leak=1")
			res := httptest.NewRecorder()

			proxy.ServeHTTP(res, req, 7, testTicketUID)

			assert.Equal(t, tc.status, res.Code)
			assert.Equal(t, tc.body, res.Body.String())
			assert.Equal(t, "audio/flac", res.Header().Get("Content-Type"))
			require.Len(t, signer.requests, 1)
			assert.Equal(t, tc.rangeValue, signer.requests[0].Range)
			assert.Equal(t, int64(7), signer.requests[0].LocalUserID)
		})
	}
}

func TestProxyFailurePolicy(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "quota denied", http.StatusTooManyRequests)
	}))
	defer origin.Close()

	tests := []struct {
		name         string
		signer       *staticSigner
		wantStatus   int
		wantFallback bool
	}{
		{
			name:         "control plane unavailable falls back before authorization",
			signer:       &staticSigner{err: errors.New("control plane unavailable")},
			wantStatus:   http.StatusTeapot,
			wantFallback: true,
		},
		{
			name:       "ticket expiry is returned without fallback",
			signer:     &staticSigner{err: &AuthorizationError{StatusCode: http.StatusGone, Err: errors.New("expired")}},
			wantStatus: http.StatusGone,
		},
		{
			name:       "upstream quota denial is preserved",
			signer:     &staticSigner{authorization: authorizationFor(origin)},
			wantStatus: http.StatusTooManyRequests,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var fallbackCalls atomic.Int32
			fallback := func(w http.ResponseWriter, _ *http.Request) bool {
				fallbackCalls.Add(1)
				w.WriteHeader(http.StatusTeapot)
				return true
			}
			proxy := NewProxy(ProxyConfig{AllowPrivateNetworks: true}, tc.signer, fallback, nil)
			request := httptest.NewRequest(http.MethodGet, "/api/federation/remote/streams/"+testTicketUID, nil)
			response := httptest.NewRecorder()

			proxy.ServeHTTP(response, request, 7, testTicketUID)

			assert.Equal(t, tc.wantStatus, response.Code)
			assert.Equal(t, tc.wantFallback, fallbackCalls.Load() == 1)
		})
	}
}

func TestProxyRejectsInvalidAuthorizationMaterial(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer origin.Close()

	tests := []struct {
		name   string
		mutate func(*Authorization)
	}{
		{name: "expired", mutate: func(a *Authorization) { a.ExpiresAt = time.Now().Add(-time.Second) }},
		{name: "wrong audience", mutate: func(a *Authorization) { a.Audience = "other" }},
		{name: "wrong path", mutate: func(a *Authorization) { a.RequestPath = "/other" }},
		{name: "credentials", mutate: func(a *Authorization) { a.ConnectionURL = "http://user:pass@127.0.0.1/x" }},
		{name: "untrusted header", mutate: func(a *Authorization) { a.SignedHeaders["Authorization"] = "secret" }},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			authorization := authorizationFor(origin)
			tc.mutate(&authorization)
			proxy := NewProxy(ProxyConfig{AllowPrivateNetworks: true}, &staticSigner{authorization: authorization}, nil, nil)
			request := httptest.NewRequest(http.MethodGet, "/api/federation/remote/streams/"+testTicketUID, nil)
			response := httptest.NewRecorder()

			proxy.ServeHTTP(response, request, 7, testTicketUID)

			assert.Equal(t, http.StatusBadGateway, response.Code)
		})
	}
}

func TestProxyStopsOnRevocationAndClientCancellation(t *testing.T) {
	chunk := strings.Repeat("x", 64*1024)
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher := w.(http.Flusher)
		for {
			select {
			case <-r.Context().Done():
				return
			default:
				_, _ = io.WriteString(w, chunk)
				flusher.Flush()
			}
		}
	}))
	defer origin.Close()

	var checks atomic.Int32
	revoked := func(_ context.Context, _ string) bool { return checks.Add(1) > 2 }
	proxy := NewProxy(ProxyConfig{AllowPrivateNetworks: true}, &staticSigner{authorization: authorizationFor(origin)}, nil, revoked)
	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest(http.MethodGet, "/api/federation/remote/streams/"+testTicketUID, nil).WithContext(ctx)
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() {
		proxy.ServeHTTP(response, request, 7, testTicketUID)
		close(done)
	}()

	time.Sleep(10 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("proxy did not stop after revocation/cancellation")
	}
	assert.Less(t, response.Body.Len(), 1024*1024)
}

func TestControlPlaneSignerMapsResponsesAndLimitsBodies(t *testing.T) {
	authorization := `{
		"authorization_uid":"22222222-2222-4222-8222-222222222222",
		"ticket_uid":"11111111-1111-4111-8111-111111111111",
		"audience":"crate-readplane","method":"GET",
		"request_path":"/api/federation/remote/streams/11111111-1111-4111-8111-111111111111",
		"external_url":"https://peer.example.test/stream",
		"connection_url":"https://203.0.113.10/stream",
		"host_header":"peer.example.test","sni_hostname":"peer.example.test",
		"signed_headers":{"X-Crate-Signature":"ed25519:test"},
		"expires_at":"2099-01-01T00:00:00Z"}`

	for _, tc := range []struct {
		name       string
		status     int
		body       string
		wantStatus int
		wantErr    bool
	}{
		{name: "success", status: http.StatusOK, body: authorization},
		{name: "denied", status: http.StatusTooManyRequests, body: `{"detail":"quota"}`, wantStatus: http.StatusTooManyRequests, wantErr: true},
		{name: "oversized", status: http.StatusOK, body: strings.Repeat("x", 70*1024), wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				assert.Equal(t, "service-token", r.Header.Get("X-Crate-Service-Token"))
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, tc.body)
			}))
			defer server.Close()
			signer, err := NewControlPlaneSigner(server.URL, "service-token", time.Second)
			require.NoError(t, err)

			_, err = signer.Authorize(context.Background(), AuthorizationRequest{TicketUID: testTicketUID})
			assert.Equal(t, tc.wantErr, err != nil)
			if tc.wantStatus != 0 {
				var authErr *AuthorizationError
				require.ErrorAs(t, err, &authErr)
				assert.Equal(t, tc.wantStatus, authErr.StatusCode)
			}
		})
	}
}
