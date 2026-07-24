package postgres

import (
	"strings"
	"testing"
)

func TestRequiredTablesQueryIncludesCanonicalDependencies(t *testing.T) {
	t.Parallel()

	for _, table := range []string{
		"global_catalog_artists",
		"global_catalog_albums",
		"global_catalog_tracks",
		"global_catalog_sources",
		"global_catalog_state",
		"global_catalog_entity_genres",
		"genre_taxonomy_releases",
		"federation_stream_tickets",
	} {
		t.Run(table, func(t *testing.T) {
			t.Parallel()
			if !strings.Contains(requiredTablesReadyQuery, "public."+table) {
				t.Fatalf("required schema query does not include %s", table)
			}
		})
	}
}
