package routes

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestRotateHomeHeroRowsIsStablePerDayAndVariesOverTime(t *testing.T) {
	rows := []any{
		map[string]any{"id": float64(1), "name": "Artist 1"},
		map[string]any{"id": float64(2), "name": "Artist 2"},
		map[string]any{"id": float64(3), "name": "Artist 3"},
		map[string]any{"id": float64(4), "name": "Artist 4"},
		map[string]any{"id": float64(5), "name": "Artist 5"},
	}
	day := time.Date(2026, 8, 2, 10, 0, 0, 0, time.UTC)

	sameDay := rotateHomeHeroRows(rows, 7, day)
	repeatedSameDay := rotateHomeHeroRows(rows, 7, day.Add(3*time.Hour))
	seen := map[string]struct{}{}
	for offset := 0; offset < 31; offset++ {
		rotated := rotateHomeHeroRows(rows, 7, day.AddDate(0, 0, offset))
		seen[rotated[0].(map[string]any)["name"].(string)] = struct{}{}
	}

	assert.Equal(t, sameDay, repeatedSameDay)
	assert.GreaterOrEqual(t, len(seen), 2)
}

func TestRotateHomeHeroPayloadDoesNotMutateInput(t *testing.T) {
	payload := map[string]any{
		"hero": []any{
			map[string]any{"name": "First"},
			map[string]any{"name": "Second"},
		},
	}

	rotated := rotateHomeHeroPayload(payload, 7, time.Date(2026, 8, 2, 0, 0, 0, 0, time.UTC))

	assert.Equal(t, "First", payload["hero"].([]any)[0].(map[string]any)["name"])
	assert.Len(t, rotated["hero"], 2)
}
