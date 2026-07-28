package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestAuthenticateIdentityAcceptsExactPathMediaTicket(t *testing.T) {
	authenticator := NewAuthenticatorWithCache(nil, "secret", time.Second, time.Minute, 10)
	var identityCalls atomic.Int32
	authenticator.sessionTouch = func(context.Context, string) error {
		return nil
	}
	authenticator.SetMediaTicketLookup(func(_ context.Context, key string) (string, time.Duration, error) {
		assert.Equal(
			t,
			"media-access:v1:9a5ac395e0b731561f4b4993cf0dd3458a35ff99baadf1ec822107f0f57c6a6b",
			key,
		)
		return `{"user_id":12,"session_id":"session-1","audience":"artwork","path":"/api/albums/1/cover"}`,
			time.Minute,
			nil
	})
	authenticator.identityLookup = func(_ context.Context, payload JWTPayload) (*User, time.Time, error) {
		identityCalls.Add(1)
		assert.Equal(t, int64(12), payload.UserID)
		assert.Equal(t, "session-1", payload.SessionID)
		return &User{
			ID:        payload.UserID,
			Email:     "diego@example.com",
			Role:      "user",
			SessionID: &payload.SessionID,
		}, time.Now().Add(time.Hour), nil
	}
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/albums/1/cover?size=256&media_ticket=exact-ticket",
		nil,
	)

	user, err := authenticator.AuthenticateIdentity(request, true)

	assert.NoError(t, err)
	assert.Equal(t, int64(12), user.ID)
	assert.Equal(t, int32(1), identityCalls.Load())
}

func TestAuthenticateIdentityRejectsInvalidMediaTicketBindings(t *testing.T) {
	tests := []struct {
		name          string
		requestPath   string
		allowTicket   bool
		payload       string
		ttl           time.Duration
		lookupErr     error
		expectedError error
	}{
		{
			name:          "query credential disabled",
			requestPath:   "/api/albums/1/cover?media_ticket=ticket",
			allowTicket:   false,
			payload:       `{"user_id":12,"session_id":"session-1","audience":"artwork","path":"/api/albums/1/cover"}`,
			ttl:           time.Minute,
			expectedError: ErrUnauthorized,
		},
		{
			name:          "wrong path",
			requestPath:   "/api/albums/2/cover?media_ticket=ticket",
			allowTicket:   true,
			payload:       `{"user_id":12,"session_id":"session-1","audience":"artwork","path":"/api/albums/1/cover"}`,
			ttl:           time.Minute,
			expectedError: ErrUnauthorized,
		},
		{
			name:          "wrong audience",
			requestPath:   "/api/albums/1/cover?media_ticket=ticket",
			allowTicket:   true,
			payload:       `{"user_id":12,"session_id":"session-1","audience":"stream","path":"/api/albums/1/cover"}`,
			ttl:           time.Minute,
			expectedError: ErrUnauthorized,
		},
		{
			name:          "expired",
			requestPath:   "/api/albums/1/cover?media_ticket=ticket",
			allowTicket:   true,
			payload:       `{"user_id":12,"session_id":"session-1","audience":"artwork","path":"/api/albums/1/cover"}`,
			ttl:           0,
			expectedError: ErrUnauthorized,
		},
		{
			name:          "redis unavailable",
			requestPath:   "/api/albums/1/cover?media_ticket=ticket",
			allowTicket:   true,
			lookupErr:     errors.New("redis unavailable"),
			expectedError: ErrUnavailable,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			authenticator := NewAuthenticatorWithCache(nil, "secret", time.Second, time.Minute, 10)
			authenticator.SetMediaTicketLookup(func(context.Context, string) (string, time.Duration, error) {
				return tt.payload, tt.ttl, tt.lookupErr
			})
			authenticator.identityLookup = func(context.Context, JWTPayload) (*User, time.Time, error) {
				t.Fatal("invalid media tickets must not reach the identity lookup")
				return nil, time.Time{}, nil
			}
			request := httptest.NewRequest(http.MethodGet, tt.requestPath, nil)

			_, err := authenticator.AuthenticateIdentity(request, tt.allowTicket)

			assert.ErrorIs(t, err, tt.expectedError)
		})
	}
}

func TestMediaAudienceForPathMatchesFastAPIContract(t *testing.T) {
	tests := []struct {
		path     string
		audience string
	}{
		{path: "/api/albums/1/cover", audience: "artwork"},
		{path: "/api/artists/1/background", audience: "artwork"},
		{path: "/api/tracks/1/stream", audience: "stream"},
		{path: "/api/federation/remote/streams/ticket", audience: "stream"},
		{path: "/api/cache/events", audience: "sse"},
		{path: "/api/me/home/discovery-stream", audience: "sse"},
		{path: "/api/jam/room/ws", audience: "ws"},
		{path: "/api/catalog/search", audience: ""},
		{path: "/outside/api/cover", audience: ""},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			assert.Equal(t, tt.audience, mediaAudienceForPath(tt.path))
		})
	}
}

func TestExtractToken(t *testing.T) {
	t.Run("prefers bearer token", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/?token=query", nil)
		req.Header.Set("Authorization", "Bearer header-token")
		req.AddCookie(&http.Cookie{Name: listenCookieName, Value: "cookie-token"})

		token := ExtractToken(req, true)
		assert.Equal(t, "header-token", token)
	})

	t.Run("allows query only when enabled", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/?token=query-token", nil)

		assert.Equal(t, "", ExtractToken(req, false))
		assert.Equal(t, "query-token", ExtractToken(req, true))
	})

	t.Run("falls back to default cookie", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.AddCookie(&http.Cookie{Name: defaultCookieName, Value: "default-cookie"})

		token := ExtractToken(req, false)
		assert.Equal(t, "default-cookie", token)
	})

	t.Run("returns cookie candidates in fallback order", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.AddCookie(&http.Cookie{Name: listenCookieName, Value: "stale-listen-cookie"})
		req.AddCookie(&http.Cookie{Name: defaultCookieName, Value: "valid-default-cookie"})

		candidates := ExtractTokenCandidates(req, false)

		assert.Equal(t, []string{"stale-listen-cookie", "valid-default-cookie"}, candidates)
	})

	t.Run("keeps bearer token authoritative", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/?token=query-token", nil)
		req.Header.Set("Authorization", "Bearer header-token")
		req.AddCookie(&http.Cookie{Name: listenCookieName, Value: "cookie-token"})

		candidates := ExtractTokenCandidates(req, true)

		assert.Equal(t, []string{"header-token"}, candidates)
	})
}

func TestAuthenticateIdentityCachesAndHydratesProfileLazily(t *testing.T) {
	now := time.Now()
	token := signTestJWT(t, "secret", map[string]any{
		"user_id": 12,
		"email":   "diego@example.com",
		"sid":     "session-1",
		"exp":     now.Add(time.Hour).Unix(),
	})
	authenticator := NewAuthenticatorWithCache(nil, "secret", time.Second, time.Minute, 10)
	var identityCalls atomic.Int32
	var accountCalls atomic.Int32
	authenticator.identityLookup = func(_ context.Context, payload JWTPayload) (*User, time.Time, error) {
		identityCalls.Add(1)
		return &User{ID: payload.UserID, Email: payload.Email, Role: "user"}, now.Add(time.Hour), nil
	}
	authenticator.accountsLookup = func(context.Context, int64) ([]ConnectedAccount, error) {
		accountCalls.Add(1)
		return []ConnectedAccount{{Provider: "lastfm", Status: "connected"}}, nil
	}
	request := httptest.NewRequest(http.MethodGet, "/api/search", nil)
	request.Header.Set("Authorization", "Bearer "+token)

	first, err := authenticator.AuthenticateIdentity(request, false)
	assert.NoError(t, err)
	second, err := authenticator.AuthenticateIdentity(request, false)
	assert.NoError(t, err)
	assert.Equal(t, first.ID, second.ID)
	assert.Equal(t, int32(1), identityCalls.Load())
	assert.Equal(t, int32(0), accountCalls.Load())

	profile, err := authenticator.AuthenticateProfile(request, false)
	assert.NoError(t, err)
	assert.Equal(t, []ConnectedAccount{{Provider: "lastfm", Status: "connected"}}, profile.ConnectedAccounts)
	assert.Equal(t, int32(1), identityCalls.Load())
	assert.Equal(t, int32(1), accountCalls.Load())
}

func TestIdentityCacheIsBoundedInvalidatableAndSingleFlight(t *testing.T) {
	authenticator := NewAuthenticatorWithCache(nil, "secret", time.Second, time.Minute, 2)
	var lookups atomic.Int32
	release := make(chan struct{})
	authenticator.identityLookup = func(_ context.Context, payload JWTPayload) (*User, time.Time, error) {
		lookups.Add(1)
		<-release
		return &User{ID: payload.UserID, Email: payload.Email, Role: "user"}, time.Now().Add(time.Hour), nil
	}
	token := signTestJWT(t, "secret", map[string]any{
		"user_id": 7, "email": "user@example.com", "exp": time.Now().Add(time.Hour).Unix(),
	})
	request := httptest.NewRequest(http.MethodGet, "/api/me/home/discovery", nil)
	request.Header.Set("Authorization", "Bearer "+token)

	var group sync.WaitGroup
	group.Add(8)
	for range 8 {
		go func() {
			defer group.Done()
			_, _ = authenticator.AuthenticateIdentity(request.Clone(context.Background()), false)
		}()
	}
	time.Sleep(10 * time.Millisecond)
	close(release)
	group.Wait()

	assert.Equal(t, int32(1), lookups.Load())
	stats := authenticator.Stats()
	assert.Equal(t, int64(1), stats.DBLookups)
	assert.GreaterOrEqual(t, stats.Hits, int64(7))
	assert.Equal(t, 1, stats.Entries)

	authenticator.InvalidateScope("auth")
	assert.Equal(t, 0, authenticator.Stats().Entries)
	assert.Equal(t, int64(1), authenticator.Stats().Invalidations)
}

func TestSessionLastSeenTouchIsAsynchronousAndThrottled(t *testing.T) {
	authenticator := NewAuthenticatorWithCache(nil, "secret", time.Second, time.Minute, 10)
	authenticator.touchInterval = time.Hour
	touched := make(chan string, 2)
	authenticator.sessionTouch = func(_ context.Context, sessionID string) error {
		touched <- sessionID
		return nil
	}

	authenticator.scheduleSessionTouch("session-1")
	authenticator.scheduleSessionTouch("session-1")

	select {
	case sessionID := <-touched:
		assert.Equal(t, "session-1", sessionID)
	case <-time.After(time.Second):
		t.Fatal("session touch did not run asynchronously")
	}
	select {
	case sessionID := <-touched:
		t.Fatalf("unexpected duplicate session touch: %s", sessionID)
	case <-time.After(25 * time.Millisecond):
	}
}
