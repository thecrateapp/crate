package config

import (
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultAddr                  = ":8686"
	defaultRedisURL              = "redis://localhost:6379/0"
	defaultFallbackBase          = "http://api:8585"
	defaultMaxDBConns            = 8
	defaultMinDBConns            = 1
	defaultQueryTimeoutMS        = 800
	defaultSnapshotMaxAgeSeconds = 600
	defaultStaleMaxAgeSeconds    = 3600
	defaultRouteMode             = "shadow"
)

// Config holds all runtime configuration for the readplane service.
type Config struct {
	Addr                           string
	DatabaseURL                    string
	RedisURL                       string
	DurableRedisURL                string
	JWTSecret                      string
	Enabled                        bool
	MaxDBConns                     int32
	MinDBConns                     int32
	QueryTimeout                   time.Duration
	SnapshotMaxAge                 time.Duration
	StaleMaxAge                    time.Duration
	StatsSnapshotMaxAge            time.Duration
	StatsStaleMaxAge               time.Duration
	AuthCacheTTL                   time.Duration
	AuthCacheMaxEntries            int
	SessionTouchInterval           time.Duration
	EnableSSE                      bool
	RouteMode                      string
	APIBase                        string
	FallbackEnabled                bool
	FallbackTimeout                time.Duration
	FallbackFailureThreshold       int
	FallbackOpenDuration           time.Duration
	FederationProxyEnabled         bool
	FederationAllowPrivateNetworks bool
	ServiceToken                   string
	FederationControlTimeout       time.Duration
	FederationConnectTimeout       time.Duration
	FederationHeaderTimeout        time.Duration
	Version                        string
	LocalMediaEnabled              bool
	MusicRoot                      string
	CacheRoot                      string
	CORSAllowedOrigins             []string
}

// Load reads environment variables and returns a populated Config.
func Load(version string) Config {
	return Config{
		Addr:                           stringEnv("READPLANE_ADDR", defaultAddr),
		DatabaseURL:                    databaseURL(),
		RedisURL:                       stringEnv("REDIS_CACHE_URL", stringEnv("REDIS_URL", defaultRedisURL)),
		DurableRedisURL:                stringEnv("REDIS_DURABLE_URL", stringEnv("REDIS_URL", defaultRedisURL)),
		JWTSecret:                      stringEnv("JWT_SECRET", ""),
		Enabled:                        boolEnv("READPLANE_ENABLED", true),
		MaxDBConns:                     int32Env("READPLANE_MAX_DB_CONNS", defaultMaxDBConns),
		MinDBConns:                     int32Env("READPLANE_MIN_DB_CONNS", defaultMinDBConns),
		QueryTimeout:                   msEnv("READPLANE_QUERY_TIMEOUT_MS", defaultQueryTimeoutMS),
		SnapshotMaxAge:                 secondsEnv("READPLANE_SNAPSHOT_MAX_AGE_SECONDS", defaultSnapshotMaxAgeSeconds),
		StaleMaxAge:                    secondsEnv("READPLANE_STALE_MAX_AGE_SECONDS", defaultStaleMaxAgeSeconds),
		StatsSnapshotMaxAge:            secondsEnv("READPLANE_STATS_SNAPSHOT_MAX_AGE_SECONDS", 300),
		StatsStaleMaxAge:               secondsEnv("READPLANE_STATS_STALE_MAX_AGE_SECONDS", 86400),
		AuthCacheTTL:                   secondsEnv("READPLANE_AUTH_CACHE_TTL_SECONDS", 15),
		AuthCacheMaxEntries:            positiveIntEnv("READPLANE_AUTH_CACHE_MAX_ENTRIES", 2048),
		SessionTouchInterval:           secondsEnv("READPLANE_SESSION_TOUCH_INTERVAL_SECONDS", 60),
		EnableSSE:                      boolEnv("READPLANE_ENABLE_SSE", true),
		RouteMode:                      stringEnv("READPLANE_ROUTE_MODE", defaultRouteMode),
		APIBase:                        strings.TrimRight(stringEnv("API_FALLBACK_BASE", defaultFallbackBase), "/"),
		FallbackEnabled:                boolEnv("READPLANE_FALLBACK_ENABLED", true),
		FallbackTimeout:                msEnv("READPLANE_FALLBACK_TIMEOUT_MS", 3000),
		FallbackFailureThreshold:       positiveIntEnv("READPLANE_FALLBACK_FAILURE_THRESHOLD", 5),
		FallbackOpenDuration:           secondsEnv("READPLANE_FALLBACK_OPEN_SECONDS", 10),
		FederationProxyEnabled:         boolEnv("READPLANE_FEDERATION_PROXY_ENABLED", true),
		FederationAllowPrivateNetworks: boolEnv("CRATE_FEDERATION_DEV_ALLOW_PRIVATE_NETWORKS", false),
		ServiceToken:                   stringEnv("CRATE_READPLANE_SERVICE_TOKEN", ""),
		FederationControlTimeout:       msEnv("READPLANE_FEDERATION_CONTROL_TIMEOUT_MS", 2000),
		FederationConnectTimeout:       msEnv("READPLANE_FEDERATION_CONNECT_TIMEOUT_MS", 5000),
		FederationHeaderTimeout:        msEnv("READPLANE_FEDERATION_HEADER_TIMEOUT_MS", 10000),
		Version:                        version,
		LocalMediaEnabled:              boolEnv("READPLANE_LOCAL_MEDIA_ENABLED", false),
		MusicRoot:                      absolutePathEnv("READPLANE_MUSIC_ROOT", "/music"),
		CacheRoot:                      absolutePathEnv("READPLANE_CACHE_ROOT", "/cache"),
		CORSAllowedOrigins:             corsAllowedOrigins(),
	}
}

func corsAllowedOrigins() []string {
	domain := stringEnv("DOMAIN", "localhost")
	candidates := []string{
		"https://admin." + domain,
		"https://listen." + domain,
		"https://api." + domain,
		"https://" + domain,
		"capacitor://localhost",
		"https://localhost",
		"tauri://localhost",
		"http://tauri.localhost",
		"https://tauri.localhost",
		"https://docs.cratemusic.app",
	}
	if domain == "localhost" || domain == "127.0.0.1" {
		candidates = append(candidates,
			"http://localhost:3000",
			"http://localhost:5173",
			"http://localhost:5174",
			"http://localhost:4173",
			"http://localhost:5178",
			"http://127.0.0.1:5178",
			"http://127.0.0.1:4173",
			"http://localhost:8585",
		)
	}
	candidates = append(candidates, strings.Split(os.Getenv("CRATE_CORS_EXTRA_ORIGINS"), ",")...)

	origins := make([]string, 0, len(candidates))
	seen := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		origin := strings.TrimRight(strings.TrimSpace(candidate), "/")
		if origin == "" {
			continue
		}
		if _, exists := seen[origin]; exists {
			continue
		}
		seen[origin] = struct{}{}
		origins = append(origins, origin)
	}
	return origins
}

func absolutePathEnv(key string, fallback string) string {
	value := stringEnv(key, fallback)
	if !strings.HasPrefix(value, "/") {
		return fallback
	}
	return strings.TrimRight(value, "/")
}

func databaseURL() string {
	if value := stringEnv("DATABASE_URL", ""); value != "" {
		return value
	}

	user := stringEnv("CRATE_POSTGRES_USER", "")
	password := stringEnv("CRATE_POSTGRES_PASSWORD", "")
	host := stringEnv("CRATE_POSTGRES_HOST", "")
	database := stringEnv("CRATE_POSTGRES_DB", "")
	if user == "" || host == "" || database == "" {
		return ""
	}
	port := stringEnv("CRATE_POSTGRES_PORT", "5432")
	postgresURL := url.URL{
		Scheme: "postgresql",
		User:   url.UserPassword(user, password),
		Host:   host + ":" + port,
		Path:   "/" + database,
	}
	query := postgresURL.Query()
	query.Set("sslmode", "disable")
	postgresURL.RawQuery = query.Encode()
	return postgresURL.String()
}

func stringEnv(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func boolEnv(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	switch strings.ToLower(value) {
	case "1", "true", "yes", "y", "on":
		return true
	case "0", "false", "no", "n", "off":
		return false
	default:
		return fallback
	}
}

func int32Env(key string, fallback int32) int32 {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 32)
	if err != nil || parsed < 0 {
		return fallback
	}
	return int32(parsed)
}

func msEnv(key string, fallback int) time.Duration {
	value := intEnv(key, fallback)
	if value <= 0 {
		value = fallback
	}
	return time.Duration(value) * time.Millisecond
}

func secondsEnv(key string, fallback int) time.Duration {
	value := intEnv(key, fallback)
	if value <= 0 {
		value = fallback
	}
	return time.Duration(value) * time.Second
}

func intEnv(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func positiveIntEnv(key string, fallback int) int {
	value := intEnv(key, fallback)
	if value <= 0 {
		return fallback
	}
	return value
}
