package routes

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/thecrateapp/crate/app/readplane/internal/snapshots"
)

func TestHomeSlicePayload(t *testing.T) {
	t.Run("wraps list items", func(t *testing.T) {
		row := &snapshots.Row{
			Payload: map[string]any{
				"custom_mixes": []any{
					map[string]any{"id": "punk-rock", "name": "punk rock mix"},
				},
			},
		}

		payload := homeSlicePayload(row, homeSliceRoutes["/api/me/home/mixes"])
		got, ok := payload.(map[string]any)
		assert.True(t, ok, "payload = %#v", payload)

		want := map[string]any{
			"items": []any{
				map[string]any{"id": "punk-rock", "name": "punk rock mix"},
			},
		}
		assert.Equal(t, want, got)
	})

	t.Run("uses empty list default", func(t *testing.T) {
		row := &snapshots.Row{Payload: map[string]any{}}

		payload := homeSlicePayload(row, homeSliceRoutes["/api/me/home/recently-played"])
		got, ok := payload.(map[string]any)
		assert.True(t, ok, "payload = %#v", payload)
		items, ok := got["items"].([]any)
		assert.True(t, ok, "items = %#v", got["items"])
		assert.Empty(t, items)
	})

	t.Run("returns raw hero", func(t *testing.T) {
		row := &snapshots.Row{
			Payload: map[string]any{
				"hero": map[string]any{"id": float64(7), "name": "High Vis"},
			},
		}

		payload := homeSlicePayload(row, homeSliceRoutes["/api/me/home/hero"])
		got, ok := payload.(map[string]any)
		assert.True(t, ok, "payload = %#v", payload)
		assert.Equal(t, "High Vis", got["name"])
	})
}
