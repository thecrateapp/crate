package contract

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFirstSSEDataSendsTokenAsBearerHeader(t *testing.T) {
	tests := []struct {
		name          string
		token         string
		wantAuthValue string
	}{
		{name: "with token", token: "session-jwt", wantAuthValue: "Bearer session-jwt"},
		{name: "without token", token: "", wantAuthValue: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var gotAuth, gotQuery string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotAuth = r.Header.Get("Authorization")
				gotQuery = r.URL.RawQuery
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = w.Write([]byte("data: {\"ok\":true}\n\n"))
			}))
			defer server.Close()

			data, err := NewClient(server.URL, time.Second).FirstSSEData(
				context.Background(), "/api/cache/events?replay=0", tt.token,
			)

			require.NoError(t, err)
			assert.JSONEq(t, `{"ok":true}`, string(data))
			assert.Equal(t, tt.wantAuthValue, gotAuth)
			assert.Equal(t, "replay=0", gotQuery)
		})
	}
}
