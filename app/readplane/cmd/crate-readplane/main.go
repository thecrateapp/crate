package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/thecrateapp/crate/app/readplane/internal/auth"
	"github.com/thecrateapp/crate/app/readplane/internal/catalog"
	"github.com/thecrateapp/crate/app/readplane/internal/config"
	readplanefederation "github.com/thecrateapp/crate/app/readplane/internal/federation"
	"github.com/thecrateapp/crate/app/readplane/internal/httpx"
	"github.com/thecrateapp/crate/app/readplane/internal/observability"
	"github.com/thecrateapp/crate/app/readplane/internal/postgres"
	"github.com/thecrateapp/crate/app/readplane/internal/redisx"
	"github.com/thecrateapp/crate/app/readplane/internal/routes"
	"github.com/thecrateapp/crate/app/readplane/internal/snapshots"
)

var version = "dev"

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		runHealthcheck()
		return
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	sentryEnabled, sentryShutdown, sentryErr := observability.InitSentry("readplane")
	defer sentryShutdown()
	if sentryErr != nil {
		logger.Warn("failed to initialize Sentry", "error", sentryErr)
	}
	cfg := config.Load(version)
	if !cfg.Enabled {
		logger.Warn("READPLANE_ENABLED=false; service still starting for health checks")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := postgres.Connect(ctx, cfg)
	if err != nil {
		logger.Error("failed to connect postgres", "error", err)
		observability.CaptureOperationError(err, "startup.postgres", nil)
		sentryShutdown()
		os.Exit(1)
	}

	redisClient, err := connectRedis(ctx, cfg, logger)
	if err != nil {
		logger.Error("failed to configure redis", "role", "cache", "error", err)
		observability.CaptureOperationError(err, "startup.redis", map[string]string{"role": "cache"})
		sentryShutdown()
		os.Exit(1)
	}
	var durableRedisClient *redis.Client
	if cfg.FederationProxyEnabled {
		durableRedisClient, err = connectRedisURL(ctx, cfg.DurableRedisURL, cfg.QueryTimeout, logger, "durable")
		if err != nil {
			logger.Error("failed to configure redis", "role", "durable", "error", err)
			observability.CaptureOperationError(err, "startup.redis", map[string]string{"role": "durable"})
			sentryShutdown()
			os.Exit(1)
		}
	}
	fallback, err := httpx.NewFallbackProxyWithConfig(httpx.FallbackConfig{
		Enabled:          cfg.FallbackEnabled,
		BaseURL:          cfg.APIBase,
		Version:          cfg.Version,
		RequestTimeout:   cfg.FallbackTimeout,
		FailureThreshold: cfg.FallbackFailureThreshold,
		OpenDuration:     cfg.FallbackOpenDuration,
	})
	if err != nil {
		logger.Error("failed to configure fallback proxy", "error", err)
		observability.CaptureOperationError(err, "startup.fallback", nil)
		sentryShutdown()
		os.Exit(1)
	}

	catalog.LoadDefaultTaxonomy()
	taxonomyPath := os.Getenv("READPLANE_TAXONOMY_PATH")
	if taxonomyPath == "" {
		taxonomyPath = "data/librarian/taxonomy.json"
	}
	if err := catalog.LoadTaxonomy(taxonomyPath); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			logger.Warn("failed to load taxonomy override; using built-in defaults", "path", taxonomyPath, "error", err)
			observability.CaptureOperationError(err, "startup.taxonomy", nil)
		}
	}

	authenticator := auth.NewAuthenticatorWithCache(
		pool,
		cfg.JWTSecret,
		cfg.QueryTimeout,
		cfg.AuthCacheTTL,
		cfg.AuthCacheMaxEntries,
	)
	authenticator.SetMediaTicketLookup(func(
		ticketCtx context.Context,
		key string,
	) (string, time.Duration, error) {
		value, err := redisClient.Get(ticketCtx, key).Result()
		if errors.Is(err, redis.Nil) {
			return "", 0, nil
		}
		if err != nil {
			return "", 0, err
		}
		ttl, err := redisClient.PTTL(ticketCtx, key).Result()
		if err != nil {
			return "", 0, err
		}
		return value, ttl, nil
	})
	authenticator.SetSessionTouchInterval(cfg.SessionTouchInterval)
	catalogStore := catalog.NewStore(pool, cfg.QueryTimeout)
	snapshotStore := snapshots.NewStore(pool, cfg.QueryTimeout, cfg.SnapshotMaxAge, cfg.StaleMaxAge)
	snapshotStore.SetScopeFreshness("stats:", cfg.StatsSnapshotMaxAge, cfg.StatsStaleMaxAge)
	var federationProxy *readplanefederation.Proxy
	if cfg.FederationProxyEnabled {
		signer, signerErr := readplanefederation.NewControlPlaneSigner(
			cfg.APIBase, cfg.ServiceToken, cfg.FederationControlTimeout,
		)
		if signerErr != nil {
			logger.Error("failed to configure federation control plane", "error", signerErr)
			observability.CaptureOperationError(signerErr, "startup.federation_control_plane", nil)
			sentryShutdown()
			os.Exit(1)
		}
		federationProxy = readplanefederation.NewProxy(
			readplanefederation.ProxyConfig{
				AllowPrivateNetworks:  cfg.FederationAllowPrivateNetworks,
				ConnectTimeout:        cfg.FederationConnectTimeout,
				ResponseHeaderTimeout: cfg.FederationHeaderTimeout,
			},
			signer,
			fallback.ServeHTTP,
			func(checkCtx context.Context, ticketUID string) bool {
				if durableRedisClient == nil {
					return false
				}
				key := "federation:stream-revoked:{" + ticketUID + "}"
				revoked, checkErr := durableRedisClient.Exists(checkCtx, key).Result()
				return checkErr != nil || revoked > 0
			},
		)
	}
	server := routes.NewServer(cfg, pool, redisClient, authenticator, catalogStore, snapshotStore, fallback, federationProxy, logger)
	go server.RunAuthInvalidation(ctx)

	handler := server.Handler()
	if sentryEnabled {
		handler = observability.WrapHTTP(handler)
	}

	httpServer := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		logger.Info("crate-readplane listening", "addr", cfg.Addr, "version", cfg.Version)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("http server failed", "error", err)
			observability.CaptureOperationError(err, "http.server", nil)
			stop()
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Warn("http shutdown failed", "error", err)
		observability.CaptureOperationError(err, "shutdown.http", nil)
	}
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Warn("readplane shutdown failed", "error", err)
		observability.CaptureOperationError(err, "shutdown.readplane", nil)
	}
	if durableRedisClient != nil {
		_ = durableRedisClient.Close()
	}
}

func runHealthcheck() {
	url := os.Getenv("READPLANE_HEALTHCHECK_URL")
	if url == "" {
		url = "http://127.0.0.1:8686/readyz"
	}
	client := http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		os.Exit(1)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		os.Exit(1)
	}
}

func connectRedis(ctx context.Context, cfg config.Config, logger *slog.Logger) (*redis.Client, error) {
	return connectRedisURL(ctx, cfg.RedisURL, cfg.QueryTimeout, logger, "cache")
}

func connectRedisURL(ctx context.Context, redisURL string, timeout time.Duration, logger *slog.Logger, role string) (*redis.Client, error) {
	client, err := redisx.Connect(redisURL)
	if err != nil {
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if err := redisx.Ping(pingCtx, client); err != nil {
		logger.Warn("redis ping failed during startup", "role", role, "error", err)
		observability.CaptureOperationError(err, "startup.redis_ping", map[string]string{"role": role})
	}
	return client, nil
}
