package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thecrateapp/crate/app/readplane/internal/config"
)

// Connect builds a read-only PostgreSQL connection pool from the given config.
func Connect(ctx context.Context, cfg config.Config) (*pgxpool.Pool, error) {
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}
	poolCfg.MaxConns = cfg.MaxDBConns
	poolCfg.MinConns = cfg.MinDBConns
	poolCfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeCacheStatement
	poolCfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
		_, err := conn.Exec(ctx, "SET default_transaction_read_only = on")
		return err
	}
	return pgxpool.NewWithConfig(ctx, poolCfg)
}

// WithTimeout returns a derived context with the given query timeout.
func WithTimeout(parent context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		timeout = 800 * time.Millisecond
	}
	return context.WithTimeout(parent, timeout)
}

// PoolRuntime returns bounded pgx saturation data suitable for health payloads.
func PoolRuntime(pool *pgxpool.Pool) map[string]any {
	if pool == nil {
		return map[string]any{"configured": false}
	}
	stats := pool.Stat()
	maxConns := stats.MaxConns()
	ratio := float64(0)
	if maxConns > 0 {
		ratio = float64(stats.AcquiredConns()) / float64(maxConns)
	}
	return map[string]any{
		"configured":       true,
		"max_connections":  maxConns,
		"acquired":         stats.AcquiredConns(),
		"idle":             stats.IdleConns(),
		"constructing":     stats.ConstructingConns(),
		"acquire_count":    stats.AcquireCount(),
		"empty_acquire":    stats.EmptyAcquireCount(),
		"canceled_acquire": stats.CanceledAcquireCount(),
		"saturation_ratio": ratio,
	}
}

// IsUndefinedTable reports whether the error is a missing-relation PostgreSQL error.
func IsUndefinedTable(err error) bool {
	var pgErr *pgconn.PgError
	return err != nil && AsPgError(err, &pgErr) && pgErr.Code == "42P01"
}

// AsPgError unwraps the error chain into a *pgconn.PgError.
func AsPgError(err error, target **pgconn.PgError) bool {
	return errors.As(err, target)
}

const requiredTablesReadyQuery = `
		SELECT
			to_regclass('public.users') IS NOT NULL
			AND to_regclass('public.sessions') IS NOT NULL
			AND to_regclass('public.user_external_identities') IS NOT NULL
			AND to_regclass('public.settings') IS NOT NULL
			AND to_regclass('public.ui_snapshots') IS NOT NULL
			AND to_regclass('public.global_catalog_artists') IS NOT NULL
			AND to_regclass('public.global_catalog_albums') IS NOT NULL
			AND to_regclass('public.global_catalog_tracks') IS NOT NULL
			AND to_regclass('public.global_catalog_sources') IS NOT NULL
			AND to_regclass('public.global_catalog_search_documents') IS NOT NULL
			AND to_regclass('public.global_catalog_search_projection_state') IS NOT NULL
			AND to_regclass('public.global_catalog_state') IS NOT NULL
			AND to_regclass('public.global_catalog_entity_genres') IS NOT NULL
			AND to_regclass('public.genre_taxonomy_releases') IS NOT NULL
			AND to_regclass('public.federation_stream_tickets') IS NOT NULL
	`

// RequiredTablesReady verifies that the minimal schema required by readplane exists.
func RequiredTablesReady(ctx context.Context, pool *pgxpool.Pool) error {
	var ok bool
	if err := pool.QueryRow(ctx, requiredTablesReadyQuery).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("required readplane tables are missing")
	}
	return nil
}
