package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestExtractToken(t *testing.T) {
	t.Run("prefers bearer token", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/?token=query", nil)
		req.Header.Set("Authorization", "Bearer header-token")
		req.AddCookie(&http.Cookie{Name: listenCookieName, Value: "cookie-token"})

		token := ExtractToken(req, true)
		assert.Equal(t, "header-token", token)
	})

	t.Run("allows query only when enabled", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/?token=query-token", nil)

		assert.Equal(t, "", ExtractToken(req, false))
		assert.Equal(t, "query-token", ExtractToken(req, true))
	})

	t.Run("falls back to default cookie", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.AddCookie(&http.Cookie{Name: defaultCookieName, Value: "default-cookie"})

		token := ExtractToken(req, false)
		assert.Equal(t, "default-cookie", token)
	})
}
