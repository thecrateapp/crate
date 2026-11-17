package postgres

import (
	"context"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"github.com/thecrateapp/crate/app/readplane/internal/observability"
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

func TestQueryCounterCountsEachStatement(t *testing.T) {
	queries := func() int {
		var body strings.Builder
		if err := observability.WritePrometheus(&body, nil, nil); err != nil {
			t.Fatal(err)
		}
		for _, line := range strings.Split(body.String(), "\n") {
			if value, ok := strings.CutPrefix(line, "crate_db_queries_total "); ok {
				count, err := strconv.Atoi(value)
				if err != nil {
					t.Fatal(err)
				}
				return count
			}
		}
		t.Fatal("crate_db_queries_total is not exported")
		return 0
	}
	for _, statements := range []int{1, 4} {
		t.Run(strconv.Itoa(statements), func(t *testing.T) {
			before := queries()
			ctx := context.Background()
			for range statements {
				ctx = queryCounter{}.TraceQueryStart(ctx, nil, pgx.TraceQueryStartData{SQL: "SELECT 1"})
				queryCounter{}.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{})
			}
			if got := queries() - before; got != statements {
				t.Fatalf("counted %d statements, want %d", got, statements)
			}
		})
	}
}
