package auth

import (
	"container/list"
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/sync/singleflight"

	"github.com/thecrateapp/crate/app/readplane/internal/postgres"
)

const (
	listenCookieName  = "crate_session_listen"
	defaultCookieName = "crate_session"
)

var (
	ErrUnauthorized = errors.New("unauthorized")
	ErrUnavailable  = errors.New("auth unavailable")
)

// ConnectedAccount represents an external identity linked to a Crate user.
type ConnectedAccount struct {
	Provider string `json:"provider"`
	Status   string `json:"status"`
}

// User represents an authenticated Crate user with profile and session data.
type User struct {
	ID                int64              `json:"id"`
	Email             string             `json:"email"`
	Name              *string            `json:"name"`
	Avatar            *string            `json:"avatar"`
	Role              string             `json:"role"`
	Username          *string            `json:"username"`
	Bio               *string            `json:"bio"`
	SessionID         *string            `json:"session_id"`
	ConnectedAccounts []ConnectedAccount `json:"connected_accounts"`
}

// IdentityCacheStats exposes bounded, low-cardinality auth cache diagnostics.
type IdentityCacheStats struct {
	Hits          int64
	Misses        int64
	Evictions     int64
	Invalidations int64
	DBLookups     int64
	Entries       int
}

type identityCacheEntry struct {
	key       string
	user      *User
	expiresAt time.Time
}

// Authenticator validates sessions and loads user data from the database.
type Authenticator struct {
	pool         *pgxpool.Pool
	queryTimeout time.Duration
	envSecret    string

	secretMu       sync.Mutex
	cachedDBSecret string
	secretLoadedAt time.Time

	cacheTTL          time.Duration
	cacheMaxEntries   int
	cacheMu           sync.Mutex
	cache             map[string]*list.Element
	cacheList         *list.List
	lookupGroup       singleflight.Group
	identityLookup    func(context.Context, JWTPayload) (*User, time.Time, error)
	accountsLookup    func(context.Context, int64) ([]ConnectedAccount, error)
	mediaTicketLookup MediaTicketLookup
	hits              atomic.Int64
	misses            atomic.Int64
	evictions         atomic.Int64
	invalidations     atomic.Int64
	dbLookups         atomic.Int64

	touchMu         sync.Mutex
	touchInterval   time.Duration
	touchMaxEntries int
	lastTouches     map[string]time.Time
	sessionTouch    func(context.Context, string) error
}

// NewAuthenticator creates an Authenticator using the given database pool and JWT secret.
func NewAuthenticator(pool *pgxpool.Pool, envSecret string, queryTimeout time.Duration) *Authenticator {
	return NewAuthenticatorWithCache(pool, envSecret, queryTimeout, 15*time.Second, 2048)
}

// NewAuthenticatorWithCache creates an authenticator with a bounded identity cache.
func NewAuthenticatorWithCache(
	pool *pgxpool.Pool,
	envSecret string,
	queryTimeout time.Duration,
	cacheTTL time.Duration,
	cacheMaxEntries int,
) *Authenticator {
	if cacheTTL <= 0 {
		cacheTTL = 15 * time.Second
	}
	if cacheMaxEntries <= 0 {
		cacheMaxEntries = 2048
	}
	return &Authenticator{
		pool:            pool,
		envSecret:       strings.TrimSpace(envSecret),
		queryTimeout:    queryTimeout,
		cacheTTL:        cacheTTL,
		cacheMaxEntries: cacheMaxEntries,
		cache:           make(map[string]*list.Element),
		cacheList:       list.New(),
		touchInterval:   time.Minute,
		touchMaxEntries: cacheMaxEntries,
		lastTouches:     make(map[string]time.Time),
	}
}

// SetMediaTicketLookup enables short-lived, exact-path media credentials.
func (a *Authenticator) SetMediaTicketLookup(lookup MediaTicketLookup) {
	a.mediaTicketLookup = lookup
}

// SetSessionTouchInterval controls how often an active session updates last_seen_at.
func (a *Authenticator) SetSessionTouchInterval(interval time.Duration) {
	if interval <= 0 {
		interval = time.Minute
	}
	a.touchMu.Lock()
	a.touchInterval = interval
	a.touchMu.Unlock()
}

// AuthenticateIdentity verifies revocation and returns only hot-path identity fields.
func (a *Authenticator) AuthenticateIdentity(r *http.Request, allowQueryToken bool) (*User, error) {
	var mediaTicketErr error
	if allowQueryToken && !hasAuthoritativeToken(r) && strings.TrimSpace(r.URL.Query().Get("media_ticket")) != "" {
		user, err := a.authenticateMediaTicket(r)
		if err == nil {
			return user, nil
		}
		mediaTicketErr = err
	}

	tokens := ExtractTokenCandidates(r, allowQueryToken)
	if len(tokens) == 0 {
		if mediaTicketErr != nil {
			return nil, mediaTicketErr
		}
		return nil, ErrUnauthorized
	}

	secret, err := a.jwtSecret(r.Context())
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}

	for _, token := range tokens {
		payload, err := VerifyHS256(token, secret, time.Now())
		if err != nil {
			continue
		}
		key := identityCacheKey(token)
		user, err := a.authenticatePayload(r.Context(), payload, key)
		if err == nil {
			return user, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
		}
	}

	return nil, ErrUnauthorized
}

func (a *Authenticator) authenticatePayload(
	ctx context.Context,
	payload JWTPayload,
	key string,
) (*User, error) {
	if user := a.cacheGet(key, time.Now()); user != nil {
		a.hits.Add(1)
		a.touchAuthenticatedSession(user)
		return user, nil
	}
	a.misses.Add(1)
	value, err, shared := a.lookupGroup.Do(key, func() (any, error) {
		if user := a.cacheGet(key, time.Now()); user != nil {
			return user, nil
		}
		a.dbLookups.Add(1)
		lookup := a.identityLookup
		if lookup == nil {
			lookup = a.loadIdentity
		}
		user, sessionExpiry, lookupErr := lookup(ctx, payload)
		if lookupErr != nil {
			return nil, lookupErr
		}
		a.cacheSet(key, user, identityExpiry(payload, sessionExpiry, a.cacheTTL))
		return cloneUser(user), nil
	})
	if shared {
		a.hits.Add(1)
	}
	if err != nil {
		return nil, err
	}
	user := value.(*User)
	a.touchAuthenticatedSession(user)
	return user, nil
}

func (a *Authenticator) touchAuthenticatedSession(user *User) {
	if user == nil || user.SessionID == nil {
		return
	}
	a.scheduleSessionTouch(*user.SessionID)
}

func (a *Authenticator) scheduleSessionTouch(sessionID string) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return
	}
	now := time.Now()
	if !a.claimSessionTouch(sessionID, now) {
		return
	}
	touch := a.sessionTouch
	if touch == nil {
		touch = a.updateSessionLastSeen
	}
	go func(claimedAt time.Time) {
		timeout := a.queryTimeout
		if timeout <= 0 {
			timeout = time.Second
		}
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		if err := touch(ctx, sessionID); err != nil {
			a.releaseSessionTouch(sessionID, claimedAt)
		}
	}(now)
}

func (a *Authenticator) claimSessionTouch(sessionID string, now time.Time) bool {
	a.touchMu.Lock()
	defer a.touchMu.Unlock()
	if last, ok := a.lastTouches[sessionID]; ok && now.Sub(last) < a.touchInterval {
		return false
	}
	if _, exists := a.lastTouches[sessionID]; !exists && len(a.lastTouches) >= a.touchMaxEntries {
		var oldestID string
		var oldest time.Time
		for candidateID, touchedAt := range a.lastTouches {
			if oldestID == "" || touchedAt.Before(oldest) {
				oldestID = candidateID
				oldest = touchedAt
			}
		}
		delete(a.lastTouches, oldestID)
	}
	a.lastTouches[sessionID] = now
	return true
}

func (a *Authenticator) releaseSessionTouch(sessionID string, claimedAt time.Time) {
	a.touchMu.Lock()
	defer a.touchMu.Unlock()
	if current, ok := a.lastTouches[sessionID]; ok && current.Equal(claimedAt) {
		delete(a.lastTouches, sessionID)
	}
}

func (a *Authenticator) updateSessionLastSeen(ctx context.Context, sessionID string) error {
	_, err := a.pool.Exec(ctx, `
		UPDATE sessions
		SET last_seen_at = NOW()
		WHERE id = $1
		  AND revoked_at IS NULL
		  AND expires_at > NOW()
	`, sessionID)
	return err
}

// AuthenticateProfile hydrates connected accounts only for profile responses.
func (a *Authenticator) AuthenticateProfile(r *http.Request, allowQueryToken bool) (*User, error) {
	user, err := a.AuthenticateIdentity(r, allowQueryToken)
	if err != nil {
		return nil, err
	}
	lookup := a.accountsLookup
	if lookup == nil {
		lookup = a.connectedAccounts
	}
	accounts, err := lookup(r.Context(), user.ID)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	profile := cloneUser(user)
	profile.ConnectedAccounts = accounts
	return profile, nil
}

// Authenticate is the backward-compatible minimal-identity entry point.
func (a *Authenticator) Authenticate(r *http.Request, allowQueryToken bool) (*User, error) {
	return a.AuthenticateIdentity(r, allowQueryToken)
}

// InvalidateScope evicts cached revocable identities for auth/session changes.
func (a *Authenticator) InvalidateScope(scope string) {
	normalized := strings.ToLower(strings.TrimSpace(scope))
	if normalized != "auth" && !strings.HasPrefix(normalized, "auth:") &&
		!strings.HasPrefix(normalized, "session:") && !strings.HasPrefix(normalized, "user:") {
		return
	}
	a.cacheMu.Lock()
	a.cache = make(map[string]*list.Element)
	a.cacheList.Init()
	a.cacheMu.Unlock()
	a.invalidations.Add(1)
}

// Stats returns an atomic snapshot of identity-cache behavior.
func (a *Authenticator) Stats() IdentityCacheStats {
	a.cacheMu.Lock()
	entries := len(a.cache)
	a.cacheMu.Unlock()
	return IdentityCacheStats{
		Hits:          a.hits.Load(),
		Misses:        a.misses.Load(),
		Evictions:     a.evictions.Load(),
		Invalidations: a.invalidations.Load(),
		DBLookups:     a.dbLookups.Load(),
		Entries:       entries,
	}
}

// ExtractToken extracts a bearer token from the Authorization header, query string, or cookies.
func ExtractToken(r *http.Request, allowQueryToken bool) string {
	tokens := ExtractTokenCandidates(r, allowQueryToken)
	if len(tokens) == 0 {
		return ""
	}
	return tokens[0]
}

// ExtractTokenCandidates extracts auth candidates in the same priority order as FastAPI.
//
// Bearer and query-string tokens are authoritative. Cookies can have stale app-specific
// values, so return both the Listen cookie and the default cookie as fallbacks.
func ExtractTokenCandidates(r *http.Request, allowQueryToken bool) []string {
	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if authHeader != "" {
		scheme, token, ok := strings.Cut(authHeader, " ")
		if ok && strings.EqualFold(scheme, "Bearer") {
			token = strings.TrimSpace(token)
			if token != "" {
				return []string{token}
			}
		}
	}
	if allowQueryToken {
		if token := strings.TrimSpace(r.URL.Query().Get("token")); token != "" {
			return []string{token}
		}
	}
	tokens := make([]string, 0, 2)
	if cookie, err := r.Cookie(listenCookieName); err == nil {
		if token := strings.TrimSpace(cookie.Value); token != "" {
			tokens = append(tokens, token)
		}
	}
	if cookie, err := r.Cookie(defaultCookieName); err == nil {
		token := strings.TrimSpace(cookie.Value)
		if token != "" && !containsToken(tokens, token) {
			tokens = append(tokens, token)
		}
	}
	return tokens
}

func containsToken(tokens []string, token string) bool {
	for _, candidate := range tokens {
		if candidate == token {
			return true
		}
	}
	return false
}

func identityCacheKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", sum[:])
}

func identityExpiry(payload JWTPayload, sessionExpiry time.Time, ttl time.Duration) time.Time {
	expiresAt := time.Now().Add(ttl)
	if payload.Expires > 0 {
		tokenExpiry := time.Unix(payload.Expires, 0)
		if tokenExpiry.Before(expiresAt) {
			expiresAt = tokenExpiry
		}
	}
	if !sessionExpiry.IsZero() && sessionExpiry.Before(expiresAt) {
		expiresAt = sessionExpiry
	}
	return expiresAt
}

func (a *Authenticator) cacheGet(key string, now time.Time) *User {
	a.cacheMu.Lock()
	defer a.cacheMu.Unlock()
	element, ok := a.cache[key]
	if !ok {
		return nil
	}
	entry := element.Value.(*identityCacheEntry)
	if !now.Before(entry.expiresAt) {
		delete(a.cache, key)
		a.cacheList.Remove(element)
		return nil
	}
	a.cacheList.MoveToFront(element)
	return cloneUser(entry.user)
}

func (a *Authenticator) cacheSet(key string, user *User, expiresAt time.Time) {
	if user == nil || !time.Now().Before(expiresAt) {
		return
	}
	a.cacheMu.Lock()
	defer a.cacheMu.Unlock()
	if existing, ok := a.cache[key]; ok {
		entry := existing.Value.(*identityCacheEntry)
		entry.user = cloneUser(user)
		entry.expiresAt = expiresAt
		a.cacheList.MoveToFront(existing)
		return
	}
	element := a.cacheList.PushFront(&identityCacheEntry{
		key: key, user: cloneUser(user), expiresAt: expiresAt,
	})
	a.cache[key] = element
	for len(a.cache) > a.cacheMaxEntries {
		oldest := a.cacheList.Back()
		if oldest == nil {
			break
		}
		delete(a.cache, oldest.Value.(*identityCacheEntry).key)
		a.cacheList.Remove(oldest)
		a.evictions.Add(1)
	}
}

func cloneUser(user *User) *User {
	if user == nil {
		return nil
	}
	clone := *user
	clone.ConnectedAccounts = append([]ConnectedAccount(nil), user.ConnectedAccounts...)
	return &clone
}

func (a *Authenticator) jwtSecret(ctx context.Context) (string, error) {
	if a.envSecret != "" {
		return a.envSecret, nil
	}

	a.secretMu.Lock()
	defer a.secretMu.Unlock()
	if a.cachedDBSecret != "" && time.Since(a.secretLoadedAt) < time.Minute {
		return a.cachedDBSecret, nil
	}

	queryCtx, cancel := postgres.WithTimeout(ctx, a.queryTimeout)
	defer cancel()

	var secret sql.NullString
	if err := a.pool.QueryRow(queryCtx, "SELECT value FROM settings WHERE key = 'jwt_secret'").Scan(&secret); err != nil {
		return "", err
	}
	if !secret.Valid || strings.TrimSpace(secret.String) == "" {
		return "", fmt.Errorf("settings.jwt_secret is empty")
	}
	a.cachedDBSecret = strings.TrimSpace(secret.String)
	a.secretLoadedAt = time.Now()
	return a.cachedDBSecret, nil
}

func (a *Authenticator) loadIdentity(ctx context.Context, payload JWTPayload) (*User, time.Time, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, a.queryTimeout)
	defer cancel()

	user := &User{}
	var username, name, bio, avatar sql.NullString
	var sessionID sql.NullString
	var sessionExpiresAt time.Time

	if payload.SessionID != "" {
		const query = `
			SELECT
				u.id,
				u.email,
				u.role,
				u.username,
				u.name,
				u.bio,
				u.avatar,
				s.id,
				s.expires_at
			FROM sessions s
			JOIN users u ON u.id = s.user_id
			WHERE s.id = $1
			  AND s.user_id = $2
			  AND s.revoked_at IS NULL
			  AND s.expires_at > now()
			LIMIT 1
		`
		if err := a.pool.QueryRow(queryCtx, query, payload.SessionID, payload.UserID).Scan(
			&user.ID,
			&user.Email,
			&user.Role,
			&username,
			&name,
			&bio,
			&avatar,
			&sessionID,
			&sessionExpiresAt,
		); err != nil {
			return nil, time.Time{}, err
		}
	} else {
		const query = `
			SELECT id, email, role, username, name, bio, avatar
			FROM users
			WHERE id = $1
			LIMIT 1
		`
		if err := a.pool.QueryRow(queryCtx, query, payload.UserID).Scan(
			&user.ID,
			&user.Email,
			&user.Role,
			&username,
			&name,
			&bio,
			&avatar,
		); err != nil {
			return nil, time.Time{}, err
		}
	}

	user.Username = nullableString(username)
	user.Name = nullableString(name)
	user.Bio = nullableString(bio)
	user.Avatar = nullableString(avatar)
	user.SessionID = nullableString(sessionID)
	if user.Role == "" {
		user.Role = "user"
	}

	user.ConnectedAccounts = []ConnectedAccount{}
	return user, sessionExpiresAt, nil
}

func (a *Authenticator) connectedAccounts(ctx context.Context, userID int64) ([]ConnectedAccount, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, a.queryTimeout)
	defer cancel()

	rows, err := a.pool.Query(queryCtx, `
		SELECT provider, status
		FROM user_external_identities
		WHERE user_id = $1
		ORDER BY provider
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	accounts := make([]ConnectedAccount, 0)
	for rows.Next() {
		var account ConnectedAccount
		if err := rows.Scan(&account.Provider, &account.Status); err != nil {
			return nil, err
		}
		accounts = append(accounts, account)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return accounts, nil
}

func nullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}
