package routes

import (
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParseCacheInvalidationEvent(t *testing.T) {
	t.Run("valid event", func(t *testing.T) {
		event, ok := parseCacheInvalidationEvent(`{"id":42,"scope":"library","ts":123.4}`)
		assert.True(t, ok, "expected valid cache event")
		assert.Equal(t, int64(42), event.ID)
		assert.Equal(t, "library", event.Scope)
	})

	t.Run("rejects event without positive id", func(t *testing.T) {
		_, ok := parseCacheInvalidationEvent(`{"id":0,"scope":"library"}`)
		assert.False(t, ok, "accepted event without positive id")
	})
}

func TestWriteCacheInvalidationSSE(t *testing.T) {
	rec := httptest.NewRecorder()
	err := writeCacheInvalidationSSE(rec, cacheInvalidationEvent{ID: 42, Scope: "library"})
	assert.NoError(t, err)
	got := rec.Body.String()
	assert.Contains(t, got, "id: 42\n")
	assert.Contains(t, got, "data: library\n\n")
}

func TestParseLastEventID(t *testing.T) {
	id, ok := parseLastEventID("42")
	assert.True(t, ok)
	assert.Equal(t, int64(42), id)

	_, ok = parseLastEventID("nope")
	assert.False(t, ok, "accepted invalid id")
}
