package routes

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/thecrateapp/crate/app/readplane/internal/catalog"
	"github.com/thecrateapp/crate/app/readplane/internal/snapshots"
)

func TestGlobalCatalogSearchCoreFailsOpenToLocal(t *testing.T) {
	server := &Server{
		catalog: catalog.NewStore(nil, time.Second),
		logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	request := httptest.NewRequest(http.MethodGet, "/api/catalog/search?q=x", nil)
	response := httptest.NewRecorder()

	server.serveGlobalCatalogSearch(response, request)

	assert.Equal(t, http.StatusOK, response.Code)
	assert.Equal(t, string(catalog.CatalogLocalFallback), response.Header().Get("X-Crate-Catalog-Mode"))
}

func TestCatalogGenresSnapshotPolicy(t *testing.T) {
	tests := []struct {
		mode catalog.CatalogServingMode
		want bool
	}{
		{mode: catalog.CatalogLocalFallback, want: false},
		{mode: catalog.CatalogGlobalReady, want: true},
		{mode: catalog.CatalogGlobalRefreshing, want: true},
		{mode: catalog.CatalogGlobalDegraded, want: true},
	}
	for _, tt := range tests {
		assert.Equal(t, tt.want, catalogGenresUsesSnapshot(tt.mode))
	}
}

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
