package redisx

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
)

// Connect parses the Redis URL and returns a new redis.Client.
func Connect(redisURL string) (*redis.Client, error) {
	if redisURL == "" {
		return nil, fmt.Errorf("REDIS_URL is required")
	}
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	return redis.NewClient(options), nil
}

// Ping verifies connectivity to Redis or returns an error.
func Ping(ctx context.Context, client *redis.Client) error {
	if client == nil {
		return fmt.Errorf("redis client is nil")
	}
	return client.Ping(ctx).Err()
}

// SnapshotChannel builds the Redis pub/sub channel name for snapshot updates.
func SnapshotChannel(scope string, subjectKey string) string {
	if subjectKey == "" {
		subjectKey = "global"
	}
	return "crate:sse:snapshot:" + scope + ":" + subjectKey
}
