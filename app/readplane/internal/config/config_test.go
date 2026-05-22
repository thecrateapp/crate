package config

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestLoad(t *testing.T) {
	t.Run("uses defaults", func(t *testing.T) {
		t.Setenv("READPLANE_ADDR", "")
		t.Setenv("DATABASE_URL", "")
		t.Setenv("REDIS_URL", "")
		t.Setenv("JWT_SECRET", "")

		cfg := Load("test")

		assert.Equal(t, defaultAddr, cfg.Addr)
		assert.Equal(t, defaultRedisURL, cfg.RedisURL)
		assert.Equal(t, defaultQueryTimeoutMS*time.Millisecond, cfg.QueryTimeout)
		assert.True(t, cfg.Enabled, "Enabled should default to true")
		assert.True(t, cfg.FallbackEnabled, "FallbackEnabled should default to true")
	})

	t.Run("parses overrides", func(t *testing.T) {
		t.Setenv("READPLANE_ADDR", ":9999")
		t.Setenv("READPLANE_ENABLED", "false")
		t.Setenv("READPLANE_MAX_DB_CONNS", "3")
		t.Setenv("READPLANE_QUERY_TIMEOUT_MS", "1500")
		t.Setenv("READPLANE_ENABLE_SSE", "0")
		t.Setenv("READPLANE_FALLBACK_ENABLED", "yes")

		cfg := Load("test")

		assert.Equal(t, ":9999", cfg.Addr)
		assert.False(t, cfg.Enabled, "Enabled should parse false")
		assert.Equal(t, int32(3), cfg.MaxDBConns)
		assert.Equal(t, 1500*time.Millisecond, cfg.QueryTimeout)
		assert.False(t, cfg.EnableSSE, "EnableSSE should parse false")
		assert.True(t, cfg.FallbackEnabled, "FallbackEnabled should parse yes")
	})

	t.Run("builds database URL from Crate Postgres env vars", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "")
		t.Setenv("CRATE_POSTGRES_USER", "crate")
		t.Setenv("CRATE_POSTGRES_PASSWORD", "p@ss word")
		t.Setenv("CRATE_POSTGRES_HOST", "crate-postgres")
		t.Setenv("CRATE_POSTGRES_PORT", "5544")
		t.Setenv("CRATE_POSTGRES_DB", "crate_prod")

		cfg := Load("test")

		want := "postgresql://crate:p%40ss%20word@crate-postgres:5544/crate_prod?sslmode=disable"
		assert.Equal(t, want, cfg.DatabaseURL)
	})

	t.Run("prefers explicit DATABASE_URL", func(t *testing.T) {
		t.Setenv("DATABASE_URL", "postgresql://explicit/db")
		t.Setenv("CRATE_POSTGRES_USER", "crate")
		t.Setenv("CRATE_POSTGRES_HOST", "crate-postgres")
		t.Setenv("CRATE_POSTGRES_DB", "crate")

		cfg := Load("test")

		assert.Equal(t, "postgresql://explicit/db", cfg.DatabaseURL)
	})
}
