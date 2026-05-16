package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestWriteJSON(t *testing.T) {
	t.Run("errors on unserializable payload", func(t *testing.T) {
		rec := httptest.NewRecorder()
		err := WriteJSON(rec, http.StatusOK, make(chan int))
		assert.Error(t, err, "expected error for unserializable payload")
	})

	t.Run("writes payload", func(t *testing.T) {
		rec := httptest.NewRecorder()
		assert.NoError(t, WriteJSON(rec, http.StatusOK, map[string]any{"ok": true}))
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, `{"ok":true}`, rec.Body.String())
	})
}

func TestWriteError(t *testing.T) {
	rec := httptest.NewRecorder()
	assert.NoError(t, WriteError(rec, http.StatusNotFound, "not found"))
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, `{"detail":"not found"}`, rec.Body.String())
}
