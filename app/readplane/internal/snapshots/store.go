package snapshots

import (
	"container/list"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thecrateapp/crate/app/readplane/internal/postgres"
)

var ErrNotFound = errors.New("snapshot not found")

const defaultCacheTTL = 2 * time.Second

const defaultCacheMaxEntries = 1000

// SnapshotMeta contains metadata about a ui_snapshots row.
type SnapshotMeta struct {
	Scope        string     `json:"scope"`
	SubjectKey   string     `json:"subject_key"`
	Version      int64      `json:"version"`
	BuiltAt      time.Time  `json:"built_at"`
	SourceSeq    int64      `json:"source_seq"`
	StaleAfter   *time.Time `json:"stale_after"`
	Stale        bool       `json:"stale"`
	GenerationMS int64      `json:"generation_ms"`
}

// Row is a snapshot record combining payload data with metadata.
type Row struct {
	Payload map[string]any
	Meta    SnapshotMeta
}

// Store reads and caches ui_snapshots from PostgreSQL with a small LRU layer.
type Store struct {
	pool            *pgxpool.Pool
	queryTimeout    time.Duration
	maxAge          time.Duration
	staleMaxAge     time.Duration
	cacheTTL        time.Duration
	cacheMaxEntries int
	mu              sync.Mutex
	cache           map[string]*list.Element
	cacheList       *list.List
}

type lruEntry struct {
	key       string
	row       *Row
	expiresAt time.Time
}

// NewStore creates a snapshot Store with the given pool, timeout, and cache ages.
func NewStore(pool *pgxpool.Pool, queryTimeout time.Duration, maxAge time.Duration, staleMaxAge time.Duration) *Store {
	return &Store{
		pool:            pool,
		queryTimeout:    queryTimeout,
		maxAge:          maxAge,
		staleMaxAge:     staleMaxAge,
		cacheTTL:        defaultCacheTTL,
		cacheMaxEntries: defaultCacheMaxEntries,
		cache:           make(map[string]*list.Element),
		cacheList:       list.New(),
	}
}

// Get returns a cached or freshly loaded snapshot for the given scope and subject.
func (s *Store) Get(ctx context.Context, scope string, subjectKey string) (*Row, error) {
	return s.get(ctx, scope, subjectKey, false)
}

// GetFresh bypasses the in-memory cache and loads the snapshot directly from the database.
func (s *Store) GetFresh(ctx context.Context, scope string, subjectKey string) (*Row, error) {
	return s.get(ctx, scope, subjectKey, true)
}

func (s *Store) get(ctx context.Context, scope string, subjectKey string, bypassCache bool) (*Row, error) {
	key := cacheKey(scope, subjectKey)
	now := time.Now()
	if !bypassCache {
		if row := s.cacheGet(key, now); row != nil {
			return row, nil
		}
	}

	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()

	const query = `
		SELECT scope, subject_key, version, payload_json, built_at, source_seq, generation_ms, stale_after
		FROM ui_snapshots
		WHERE scope = $1 AND subject_key = $2
		LIMIT 1
	`
	var payloadBytes []byte
	var sourceSeq sql.NullInt64
	var staleAfter sql.NullTime
	row := Row{}
	if err := s.pool.QueryRow(queryCtx, query, scope, subjectKey).Scan(
		&row.Meta.Scope,
		&row.Meta.SubjectKey,
		&row.Meta.Version,
		&payloadBytes,
		&row.Meta.BuiltAt,
		&sourceSeq,
		&row.Meta.GenerationMS,
		&staleAfter,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if sourceSeq.Valid {
		row.Meta.SourceSeq = sourceSeq.Int64
	}
	if staleAfter.Valid {
		row.Meta.StaleAfter = &staleAfter.Time
	}

	stale, usable := SnapshotFreshness(row.Meta.BuiltAt, row.Meta.StaleAfter, now, s.maxAge, s.staleMaxAge)
	if !usable {
		return nil, ErrNotFound
	}
	row.Meta.Stale = stale

	payload, err := DecodePayload(payloadBytes)
	if err != nil {
		return nil, err
	}
	row.Payload = payload
	s.cacheSet(key, &row, now)
	return &row, nil
}

func cacheKey(scope string, subjectKey string) string {
	return scope + "\x00" + subjectKey
}

func (s *Store) cacheGet(key string, now time.Time) *Row {
	if s.cacheTTL <= 0 {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	elem, ok := s.cache[key]
	if !ok {
		return nil
	}
	entry := elem.Value.(*lruEntry)
	if !entry.expiresAt.After(now) {
		s.cacheList.Remove(elem)
		delete(s.cache, key)
		return nil
	}
	s.cacheList.MoveToFront(elem)
	return cloneRow(entry.row)
}

func (s *Store) cacheSet(key string, row *Row, now time.Time) {
	if s.cacheTTL <= 0 {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if elem, ok := s.cache[key]; ok {
		s.cacheList.MoveToFront(elem)
		elem.Value.(*lruEntry).row = cloneRow(row)
		elem.Value.(*lruEntry).expiresAt = now.Add(s.cacheTTL)
		return
	}
	entry := &lruEntry{key: key, row: cloneRow(row), expiresAt: now.Add(s.cacheTTL)}
	elem := s.cacheList.PushFront(entry)
	s.cache[key] = elem
	if s.cacheMaxEntries > 0 && s.cacheList.Len() > s.cacheMaxEntries {
		back := s.cacheList.Back()
		if back != nil {
			s.cacheList.Remove(back)
			delete(s.cache, back.Value.(*lruEntry).key)
		}
	}
}

func cloneRow(row *Row) *Row {
	if row == nil {
		return nil
	}
	clone := *row
	clone.Payload = cloneMap(row.Payload)
	return &clone
}

// DecoratedPayload returns the payload with embedded snapshot metadata.
func (r Row) DecoratedPayload() map[string]any {
	payload := cloneMap(r.Payload)
	payload["snapshot"] = r.Meta
	return payload
}

func cloneMap(input map[string]any) map[string]any {
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = cloneValue(value)
	}
	return output
}

func cloneValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneMap(typed)
	case []any:
		output := make([]any, len(typed))
		for index, item := range typed {
			output[index] = cloneValue(item)
		}
		return output
	default:
		return typed
	}
}

// DecodePayload unmarshals snapshot JSON into a map, wrapping scalars when needed.
func DecodePayload(raw []byte) (map[string]any, error) {
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, fmt.Errorf("decode snapshot payload: %w", err)
		}
		return map[string]any{"value": value}, nil
	}
	if payload == nil {
		return map[string]any{}, nil
	}
	return payload, nil
}

// SnapshotFreshness evaluates whether a snapshot is fresh, stale-but-usable, or expired.
func SnapshotFreshness(
	builtAt time.Time,
	staleAfter *time.Time,
	now time.Time,
	maxAge time.Duration,
	staleMaxAge time.Duration,
) (stale bool, usable bool) {
	if builtAt.IsZero() {
		return false, false
	}
	if maxAge <= 0 {
		maxAge = 10 * time.Minute
	}
	if staleMaxAge <= 0 {
		staleMaxAge = time.Hour
	}
	stale = now.Sub(builtAt) > maxAge
	if staleAfter != nil && !staleAfter.IsZero() && !staleAfter.After(now) {
		stale = true
	}
	if !stale {
		return false, true
	}
	return true, now.Sub(builtAt) <= staleMaxAge
}
