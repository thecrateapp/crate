package main

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"
)

func TestConnectRedisURLReturnsConfigurationError(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	client, err := connectRedisURL(
		context.Background(),
		"://invalid",
		time.Second,
		logger,
		"cache",
	)

	if err == nil {
		t.Fatal("expected invalid Redis URL to return an error")
	}
	if client != nil {
		t.Fatal("expected no Redis client after a configuration error")
	}
}
