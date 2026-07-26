package catalog

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestListenCatalogQueriesBoundAggregationWork(t *testing.T) {
	tests := []struct {
		name       string
		query      string
		contains   []string
		excludes   []string
		maxJoins   int
		joinTarget string
	}{
		{
			name:  "genre catalog preaggregates memberships",
			query: genresSQL,
			contains: []string{
				"artist_counts AS",
				"album_counts AS",
				"COALESCE(ac.artist_count, 0)",
				"COALESCE(alc.album_count, 0)",
			},
			excludes: []string{
				"LEFT JOIN artist_genres ag ON g.id = ag.genre_id",
				"LEFT JOIN album_genres alg ON g.id = alg.genre_id",
			},
		},
		{
			name:  "genre summary scopes counts to target",
			query: genreSummarySQL,
			contains: []string{
				"target_genre AS",
				"artist_counts AS",
				"album_counts AS",
				"JOIN target_genre",
			},
			excludes: []string{
				"LEFT JOIN artist_genres",
				"LEFT JOIN album_genres",
			},
		},
		{
			name:  "related genres preaggregate each membership domain",
			query: relatedGenresSQL,
			contains: []string{
				"taxonomy_artist_counts AS",
				"taxonomy_album_counts AS",
				"genre_artist_counts AS",
				"genre_album_counts AS",
			},
			excludes: []string{
				"LEFT JOIN artist_genres ag ON",
				"LEFT JOIN album_genres alg ON",
				"LEFT JOIN artist_genres ag_page ON",
				"LEFT JOIN album_genres alg_page ON",
			},
		},
		{
			name:  "artist albums aggregate quality after artist filter",
			query: artistAlbumsSQL,
			contains: []string{
				"artist_albums AS",
				"album_quality AS",
				"JOIN artist_albums aa ON aa.id = t.album_id",
			},
			maxJoins:   1,
			joinTarget: "library_tracks",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			for _, fragment := range tt.contains {
				assert.Contains(t, tt.query, fragment)
			}
			for _, fragment := range tt.excludes {
				assert.NotContains(t, tt.query, fragment)
			}
			if tt.joinTarget != "" {
				assert.LessOrEqual(t, strings.Count(tt.query, tt.joinTarget), tt.maxJoins)
			}
		})
	}
}
