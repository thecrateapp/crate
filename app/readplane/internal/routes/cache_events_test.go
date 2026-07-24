package routes

import (
	"net/http"
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

func TestCacheEventResumeID(t *testing.T) {
	tests := []struct {
		name       string
		header     string
		query      string
		wantID     int64
		wantResume bool
	}{
		{name: "header cursor", header: "42", query: "last_event_id=41", wantID: 42, wantResume: true},
		{name: "persisted query cursor", query: "last_event_id=41", wantID: 41, wantResume: true},
		{name: "missing cursor", wantResume: false},
		{name: "invalid cursor", query: "last_event_id=nope", wantResume: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/cache/events?"+tt.query, nil)
			if tt.header != "" {
				req.Header.Set("Last-Event-ID", tt.header)
			}

			gotID, gotResume := cacheEventResumeID(req)

			assert.Equal(t, tt.wantID, gotID)
			assert.Equal(t, tt.wantResume, gotResume)
		})
	}
}

func TestFilterCacheInvalidationEventsReplaysOnlyTheReconnectGap(t *testing.T) {
	raw := []string{
		`{"id":5,"scope":"home"}`,
		`{"id":4,"scope":"history"}`,
		`{"id":3,"scope":"library"}`,
	}

	events, latest := filterCacheInvalidationEvents(raw, 3)

	assert.Equal(t, []cacheInvalidationEvent{
		{ID: 4, Scope: "history"},
		{ID: 5, Scope: "home"},
	}, events)
	assert.Equal(t, int64(5), latest)
}
