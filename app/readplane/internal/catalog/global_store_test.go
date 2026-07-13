package catalog

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestGlobalSearchShortQueryDoesNotHitDatabase(t *testing.T) {
	store := NewStore(nil, time.Second)

	payload, err := store.GlobalSearch(context.Background(), "x", 20)

	assert.NoError(t, err)
	assert.Equal(t, []any{}, payload["artists"])
	assert.Equal(t, []any{}, payload["albums"])
	assert.Equal(t, []any{}, payload["tracks"])
}
