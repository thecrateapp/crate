package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	pathpkg "path"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const mediaTicketKeyPrefix = "media-access:v1:"

// MediaTicketLookup resolves an opaque ticket key and its remaining TTL.
type MediaTicketLookup func(context.Context, string) (string, time.Duration, error)

type mediaTicketPayload struct {
	UserID    int64  `json:"user_id"`
	SessionID string `json:"session_id"`
	Audience  string `json:"audience"`
	Path      string `json:"path"`
}

func (a *Authenticator) authenticateMediaTicket(r *http.Request) (*User, error) {
	if a.mediaTicketLookup == nil {
		return nil, ErrUnavailable
	}
	ticket := strings.TrimSpace(r.URL.Query().Get("media_ticket"))
	requestPath := r.URL.Path
	audience := mediaAudienceForPath(requestPath)
	if ticket == "" || audience == "" || !canonicalMediaPath(requestPath) {
		return nil, ErrUnauthorized
	}

	raw, ttl, err := a.mediaTicketLookup(r.Context(), mediaTicketKey(ticket))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if ttl <= 0 {
		return nil, ErrUnauthorized
	}
	var ticketPayload mediaTicketPayload
	if err := json.Unmarshal([]byte(raw), &ticketPayload); err != nil {
		return nil, ErrUnauthorized
	}
	if ticketPayload.UserID <= 0 ||
		ticketPayload.SessionID == "" ||
		ticketPayload.Audience != audience ||
		ticketPayload.Path != requestPath {
		return nil, ErrUnauthorized
	}

	payload := JWTPayload{
		UserID:    ticketPayload.UserID,
		SessionID: ticketPayload.SessionID,
		Expires:   time.Now().Add(ttl).Unix(),
	}
	key := identityCacheKey(
		fmt.Sprintf("media-session:%d:%s", payload.UserID, payload.SessionID),
	)
	user, err := a.authenticatePayload(r.Context(), payload, key)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUnauthorized
	}
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	return user, nil
}

func mediaTicketKey(ticket string) string {
	digest := sha256.Sum256([]byte(ticket))
	return mediaTicketKeyPrefix + hex.EncodeToString(digest[:])
}

func canonicalMediaPath(value string) bool {
	return len(value) <= 2048 &&
		strings.HasPrefix(value, "/api/") &&
		!strings.ContainsRune(value, '\x00') &&
		pathpkg.Clean(value) == value
}

func mediaAudienceForPath(value string) string {
	if !canonicalMediaPath(value) {
		return ""
	}
	if strings.HasSuffix(value, "/ws") && strings.Contains(value, "/jam/") {
		return "ws"
	}
	if value == "/api/events" ||
		strings.HasPrefix(value, "/api/events/") ||
		value == "/api/cache/events" ||
		value == "/api/me/connect/events" ||
		strings.HasSuffix(value, "-stream") {
		return "sse"
	}
	if strings.HasPrefix(value, "/api/stream/") ||
		strings.HasSuffix(value, "/stream") ||
		strings.Contains(value, "/streams/") {
		return "stream"
	}
	for _, marker := range []string{
		"/cover",
		"/artwork",
		"/avatar",
		"/photo",
		"/background",
		"/image",
		"/images/",
		"/export",
	} {
		if strings.Contains(value, marker) {
			return "artwork"
		}
	}
	return ""
}

func hasAuthoritativeToken(r *http.Request) bool {
	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if authHeader != "" {
		scheme, token, ok := strings.Cut(authHeader, " ")
		if ok && strings.EqualFold(scheme, "Bearer") && strings.TrimSpace(token) != "" {
			return true
		}
	}
	return strings.TrimSpace(r.URL.Query().Get("token")) != ""
}
