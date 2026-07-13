package routes

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/thecrateapp/crate/app/readplane/internal/snapshots"
)

func TestGlobalCatalogGenresPayloadRequiresMatchingTaxonomy(t *testing.T) {
	taxonomy := &snapshots.Row{Payload: map[string]any{
		"taxonomy": map[string]any{
			"id": "crate-core", "version": "1.0.0", "digest": "sha256:one",
		},
	}}
	genres := &snapshots.Row{Payload: map[string]any{
		"taxonomy": map[string]any{
			"id": "crate-core", "version": "1.0.0", "digest": "sha256:one",
		},
		"items": []any{map[string]any{"canonical_slug": "punk"}},
	}}

	payload, err := globalCatalogGenresPayload(taxonomy, genres)

	assert.NoError(t, err)
	assert.Equal(t, genres.Payload["items"], payload["items"])
}

func TestGlobalCatalogGenresPayloadRejectsMismatchedTaxonomy(t *testing.T) {
	taxonomy := &snapshots.Row{Payload: map[string]any{
		"taxonomy": map[string]any{
			"id": "crate-core", "version": "1.0.0", "digest": "sha256:one",
		},
	}}
	genres := &snapshots.Row{Payload: map[string]any{
		"taxonomy": map[string]any{
			"id": "crate-core", "version": "1.0.0", "digest": "sha256:two",
		},
		"items": []any{},
	}}

	_, err := globalCatalogGenresPayload(taxonomy, genres)

	assert.ErrorIs(t, err, snapshots.ErrTaxonomyMismatch)
}
