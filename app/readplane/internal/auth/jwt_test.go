package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestVerifyHS256(t *testing.T) {
	t.Run("accepts valid token", func(t *testing.T) {
		now := time.Unix(1_700_000_000, 0)
		token := signTestJWT(t, "secret", map[string]any{
			"user_id": 12,
			"email":   "diego@example.com",
			"role":    "admin",
			"sid":     "session-1",
			"exp":     now.Add(time.Hour).Unix(),
		})

		payload, err := VerifyHS256(token, "secret", now)
		assert.NoError(t, err)
		assert.Equal(t, int64(12), payload.UserID)
		assert.Equal(t, "diego@example.com", payload.Email)
		assert.Equal(t, "session-1", payload.SessionID)
	})

	t.Run("rejects expired token", func(t *testing.T) {
		now := time.Unix(1_700_000_000, 0)
		token := signTestJWT(t, "secret", map[string]any{
			"user_id": 12,
			"email":   "diego@example.com",
			"exp":     now.Add(-time.Second).Unix(),
		})

		_, err := VerifyHS256(token, "secret", now)
		assert.Equal(t, ErrExpiredToken, err)
	})

	t.Run("rejects tampered token", func(t *testing.T) {
		now := time.Unix(1_700_000_000, 0)
		token := signTestJWT(t, "secret", map[string]any{
			"user_id": 12,
			"email":   "diego@example.com",
			"exp":     now.Add(time.Hour).Unix(),
		})
		token = strings.TrimSuffix(token, token[len(token)-1:]) + "x"

		_, err := VerifyHS256(token, "secret", now)
		assert.Equal(t, ErrInvalidToken, err)
	})
}

func signTestJWT(t *testing.T, secret string, payload map[string]any) string {
	t.Helper()
	headerBytes, err := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	assert.NoError(t, err)
	payloadBytes, err := json.Marshal(payload)
	assert.NoError(t, err)
	head := base64.RawURLEncoding.EncodeToString(headerBytes)
	body := base64.RawURLEncoding.EncodeToString(payloadBytes)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(head + "." + body))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return head + "." + body + "." + sig
}
