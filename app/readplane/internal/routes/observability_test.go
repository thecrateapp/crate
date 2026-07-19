package routes

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/thecrateapp/crate/app/readplane/internal/httpx"
)

func TestFallbackSuccessRatio(t *testing.T) {
	tests := []struct {
		name  string
		stats httpx.FallbackStats
		want  float64
	}{
		{name: "empty", stats: httpx.FallbackStats{}, want: 0},
		{name: "mixed", stats: httpx.FallbackStats{Attempts: 10, Successes: 7}, want: 0.7},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.InDelta(t, tt.want, fallbackSuccessRatio(tt.stats), 0.0001)
		})
	}
}

func TestReadinessStatusTreatsCacheRedisAsOptional(t *testing.T) {
	tests := []struct {
		name          string
		postgresReady bool
		schemaReady   bool
		redisReady    bool
		enableSSE     bool
		wantStatus    int
		wantDegraded  bool
	}{
		{name: "all ready", postgresReady: true, schemaReady: true, redisReady: true, enableSSE: true, wantStatus: 200},
		{name: "cache redis down", postgresReady: true, schemaReady: true, enableSSE: true, wantStatus: 200, wantDegraded: true},
		{name: "sse disabled", postgresReady: true, schemaReady: true, enableSSE: false, wantStatus: 200},
		{name: "postgres down", schemaReady: true, redisReady: true, enableSSE: true, wantStatus: 503},
		{name: "schema missing", postgresReady: true, redisReady: true, enableSSE: true, wantStatus: 503},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, degraded := readinessStatus(tt.postgresReady, tt.schemaReady, tt.redisReady, tt.enableSSE)
			assert.Equal(t, tt.wantStatus, status)
			assert.Equal(t, tt.wantDegraded, degraded)
		})
	}
}
