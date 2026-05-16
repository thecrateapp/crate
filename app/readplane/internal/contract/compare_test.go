package contract

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestEqualJSON(t *testing.T) {
	t.Run("normalizes object key order", func(t *testing.T) {
		ok, diff, err := EqualJSON([]byte(`{"b":2,"a":1}`), []byte(`{"a":1,"b":2}`))
		assert.NoError(t, err)
		assert.True(t, ok, "diff = %s", diff)
	})

	t.Run("normalizes snapshot timestamp formats", func(t *testing.T) {
		left := []byte(`{"snapshot":{"built_at":"2026-05-05T09:00:00+00:00"}}`)
		right := []byte(`{"snapshot":{"built_at":"2026-05-05T09:00:00Z"}}`)

		ok, diff, err := EqualJSON(left, right)
		assert.NoError(t, err)
		assert.True(t, ok, "diff = %s", diff)
	})

	t.Run("normalizes numeric representation", func(t *testing.T) {
		ok, diff, err := EqualJSON([]byte(`{"bpm":152.0}`), []byte(`{"bpm":152}`))
		assert.NoError(t, err)
		assert.True(t, ok, "diff = %s", diff)
	})

	t.Run("reports mismatch", func(t *testing.T) {
		ok, diff, err := EqualJSON([]byte(`{"a":1}`), []byte(`{"a":2}`))
		assert.NoError(t, err)
		assert.False(t, ok)
		assert.NotEmpty(t, diff)
	})

	t.Run("reports first path mismatch", func(t *testing.T) {
		ok, diff, err := EqualJSON(
			[]byte(`{"items":[{"name":"one"},{"name":"two"}]}`),
			[]byte(`{"items":[{"name":"one"},{"name":"three"}]}`),
		)
		assert.NoError(t, err)
		assert.False(t, ok)
		assert.Equal(t, `$.items[1].name: left="two" right="three"`, diff)
	})
}
