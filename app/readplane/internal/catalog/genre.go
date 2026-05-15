package catalog

import (
	"context"
	"math"
	"strings"

	"github.com/thecrateapp/crate/app/readplane/internal/postgres"
)
func (s *Store) genreTaxonomyContext(ctx context.Context, canonicalSlug string) (any, any, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(queryCtx, `
		WITH RECURSIVE ancestors AS (
			SELECT 0 AS depth, n.id, n.slug, n.name, n.is_top_level, n.eq_gains
			FROM genre_taxonomy_nodes n
			WHERE n.slug = $1
			UNION ALL
			SELECT a.depth + 1, parent.id, parent.slug, parent.name, parent.is_top_level, parent.eq_gains
			FROM ancestors a
			JOIN genre_taxonomy_edges e
			  ON e.source_genre_id = a.id
			 AND e.relation_type = 'parent'
			JOIN genre_taxonomy_nodes parent ON parent.id = e.target_genre_id
			WHERE a.depth < 8
		)
		SELECT
			(
				SELECT jsonb_build_object('slug', slug, 'name', name, 'canonical', NULL)
				FROM ancestors
				WHERE is_top_level
				ORDER BY depth, slug
				LIMIT 1
			) AS top_level,
			(
				SELECT jsonb_build_object(
					'gains', eq_gains,
					'source', CASE WHEN depth = 0 THEN 'direct' ELSE 'inherited' END,
					'inheritedFrom', CASE
						WHEN depth = 0 THEN NULL
						ELSE jsonb_build_object('slug', slug, 'name', name)
					END
				)
				FROM ancestors
				WHERE eq_gains IS NOT NULL
				ORDER BY depth, slug
				LIMIT 1
			) AS preset
	`, canonicalSlug))
	if err != nil {
		return nil, nil, err
	}
	if len(rows) == 0 {
		return nil, nil, nil
	}
	return rows[0]["top_level"], rows[0]["preset"], nil
}

func genreTopLevelSQL(seedExpr string) string {
	return `
		WITH RECURSIVE ancestors AS (
			SELECT 0 AS depth, n.id, n.slug, n.name, n.description, n.is_top_level
			FROM genre_taxonomy_nodes n
			WHERE n.slug = ` + seedExpr + `
			UNION ALL
			SELECT a.depth + 1, parent.id, parent.slug, parent.name, parent.description, parent.is_top_level
			FROM ancestors a
			JOIN genre_taxonomy_edges e
			  ON e.source_genre_id = a.id
			 AND e.relation_type = 'parent'
			JOIN genre_taxonomy_nodes parent ON parent.id = e.target_genre_id
			WHERE a.depth < 8
		)
		SELECT slug, name, description
		FROM ancestors a
		WHERE a.is_top_level
		   OR NOT EXISTS (
		       SELECT 1
		       FROM genre_taxonomy_edges e
		       WHERE e.source_genre_id = a.id
		         AND e.relation_type = 'parent'
		   )
		ORDER BY depth, name, slug
		LIMIT 1
	`
}

func genrePresetSQL(seedExpr string) string {
	return `
		WITH RECURSIVE ancestors AS (
			SELECT 0 AS depth, n.id, n.slug, n.name, n.eq_gains
			FROM genre_taxonomy_nodes n
			WHERE n.slug = ` + seedExpr + `
			UNION ALL
			SELECT a.depth + 1, parent.id, parent.slug, parent.name, parent.eq_gains
			FROM ancestors a
			JOIN genre_taxonomy_edges e
			  ON e.source_genre_id = a.id
			 AND e.relation_type = 'parent'
			JOIN genre_taxonomy_nodes parent ON parent.id = e.target_genre_id
			WHERE a.depth < 8
		)
		SELECT
			eq_gains AS gains,
			CASE WHEN depth = 0 THEN 'direct' ELSE 'inherited' END AS source,
			slug,
			name
		FROM ancestors
		WHERE eq_gains IS NOT NULL
		ORDER BY depth, slug
		LIMIT 1
	`
}
func buildGenreProfile(rows []map[string]any, limit int) []map[string]any {
	if limit > 0 && len(rows) > limit {
		rows = rows[:limit]
	}
	prepared := []map[string]any{}
	for _, row := range rows {
		name := strings.TrimSpace(stringValue(row["name"]))
		if name == "" {
			continue
		}
		weight := floatValue(row["weight"])
		if weight < 0 {
			weight = 0
		}
		prepared = append(prepared, map[string]any{
			"name":   name,
			"slug":   row["slug"],
			"source": row["source"],
			"weight": weight,
		})
	}
	if len(prepared) == 0 {
		return []map[string]any{}
	}
	var total float64
	var maxWeight float64
	for _, item := range prepared {
		weight := floatValue(item["weight"])
		total += weight
		if weight > maxWeight {
			maxWeight = weight
		}
	}
	if total <= 0 {
		total = float64(len(prepared))
		for _, item := range prepared {
			item["weight"] = float64(1)
		}
		maxWeight = 1
	}
	out := make([]map[string]any, 0, len(prepared))
	for _, item := range prepared {
		weight := floatValue(item["weight"])
		share := float64(0)
		if total > 0 {
			share = weight / total
		}
		percent := int64(0)
		if maxWeight > 0 {
			percent = int64(math.Round((weight / maxWeight) * 100))
		}
		if weight > 0 && percent < 1 {
			percent = 1
		}
		out = append(out, map[string]any{
			"name":    item["name"],
			"slug":    item["slug"],
			"source":  item["source"],
			"weight":  roundFloat(weight, 4),
			"share":   roundFloat(share, 4),
			"percent": percent,
		})
	}
	return out
}

func annotateGenreSummary(row map[string]any, includeEQ bool) {
	canonicalSlug := strings.TrimSpace(stringValue(row["canonical_slug"]))
	mapped := canonicalSlug != ""
	row["mapped"] = mapped

	if mapped {
		if shouldUseStaticTopLevel(canonicalSlug, stringValue(row["top_level_slug"])) {
			topLevelSlug := staticGenreTopLevel[canonicalSlug]
			row["top_level_slug"] = topLevelSlug
			if meta, ok := genreTopLevelMetadata[topLevelSlug]; ok {
				row["top_level_name"] = meta["name"]
				row["top_level_description"] = meta["description"]
			} else {
				row["top_level_name"] = strings.ReplaceAll(topLevelSlug, "-", " ")
				row["top_level_description"] = ""
			}
		}
		if strings.TrimSpace(stringValue(row["top_level_slug"])) == "" {
			row["top_level_slug"] = canonicalSlug
			row["top_level_name"] = firstNonEmpty(stringValue(row["canonical_name"]), canonicalSlug)
			row["top_level_description"] = stringValue(row["canonical_description"])
		}
		row["description"] = stringValue(row["canonical_description"])
	} else {
		row["top_level_slug"] = nil
		row["top_level_name"] = nil
		row["top_level_description"] = nil
		row["description"] = nil
		row["external_description"] = nil
		row["external_description_source"] = nil
		row["musicbrainz_mbid"] = nil
		row["wikidata_entity_id"] = nil
		row["wikidata_url"] = nil
	}

	if includeEQ {
		row["eq_gains"] = normalizeFloatSlice(row["canonical_eq_gains"])
		if row["preset_gains"] != nil {
			row["eq_preset_resolved"] = map[string]any{
				"gains":  normalizeFloatSlice(row["preset_gains"]),
				"source": row["preset_source"],
				"slug":   row["preset_slug"],
				"name":   row["preset_name"],
			}
		} else {
			row["eq_preset_resolved"] = nil
		}
	} else {
		row["eq_gains"] = nil
		row["eq_preset_resolved"] = nil
	}
	delete(row, "canonical_eq_gains")
	delete(row, "preset_gains")
	delete(row, "preset_source")
	delete(row, "preset_slug")
	delete(row, "preset_name")
}

func shouldUseStaticTopLevel(canonicalSlug string, currentTopLevelSlug string) bool {
	staticTopLevelSlug, ok := staticGenreTopLevel[canonicalSlug]
	if !ok || staticTopLevelSlug == "" || staticTopLevelSlug == canonicalSlug {
		return false
	}
	current := strings.TrimSpace(currentTopLevelSlug)
	return current == "" || current == canonicalSlug
}
