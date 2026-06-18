package catalog

import (
	"context"
	"math"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/thecrateapp/crate/app/readplane/internal/postgres"
)

const (
	minGenreMembershipScore  = 0.45
	artistAlbumFallbackScore = 0.70
	relatedGenreLimit        = 24
)

var genreRelationLabels = map[string]string{
	"child":         "Subgenre",
	"sibling":       "Sibling",
	"related":       "Related",
	"influenced_by": "Influenced by",
	"influences":    "Influences",
	"fusion":        "Fusion",
}

var genreRelationPriority = map[string]int64{
	"child":         60,
	"related":       50,
	"sibling":       40,
	"influenced_by": 30,
	"influences":    20,
	"fusion":        10,
}

func genreMembershipTier(score float64) string {
	switch {
	case score >= 0.90:
		return "core"
	case score >= 0.70:
		return "strong"
	case score >= minGenreMembershipScore:
		return "adjacent"
	default:
		return "weak"
	}
}

func visibleGenreMembership(score float64) bool {
	return score >= minGenreMembershipScore
}

func annotateGenreMembershipRows(rows []map[string]any) {
	for _, row := range rows {
		score := floatValue(row["membership_score"])
		row["membership_score"] = score
		row["membership_tier"] = genreMembershipTier(score)
	}
}

func buildRelatedGenrePayloads(rows []map[string]any, relations map[string]string, limit int) []map[string]any {
	items := []map[string]any{}
	for _, row := range rows {
		slug := strings.TrimSpace(stringValue(row["slug"]))
		if slug == "" {
			continue
		}
		relationType := strings.TrimSpace(stringValue(row["relation_type"]))
		if relationType == "" && relations != nil {
			relationType = strings.TrimSpace(relations[slug])
		}
		relationLabel, ok := genreRelationLabels[relationType]
		if !ok {
			continue
		}
		artistCount := intValue(row["artist_count"])
		albumCount := intValue(row["album_count"])
		contentScore := artistCount*3 + albumCount
		if contentScore <= 0 {
			continue
		}
		coverURL := stringValue(row["cover_url"])
		if coverURL == "" && (stringValue(row["canonical_cover_path"]) != "" || stringValue(row["cover_path"]) != "") {
			coverURL = genreCoverPublicURL(slug)
		}
		topArtistID := intValue(row["top_artist_id"])
		topArtistPhotoURL := stringValue(row["top_artist_photo_url"])
		if topArtistPhotoURL == "" && topArtistID > 0 {
			topArtistPhotoURL = artistPhotoPublicURL(topArtistID)
		}
		items = append(items, map[string]any{
			"slug":                 slug,
			"name":                 firstNonEmpty(stringValue(row["page_name"]), stringValue(row["name"]), strings.ReplaceAll(slug, "-", " ")),
			"page_slug":            firstNonEmpty(stringValue(row["page_slug"]), slug),
			"relation_type":        relationType,
			"relation_label":       relationLabel,
			"description":          firstNonEmpty(stringValue(row["description"]), stringValue(row["external_description"])),
			"artist_count":         artistCount,
			"album_count":          albumCount,
			"content_score":        contentScore,
			"cover_url":            nilIfEmpty(coverURL),
			"top_artist_id":        nilIfZero(topArtistID),
			"top_artist_slug":      nilIfEmpty(stringValue(row["top_artist_slug"])),
			"top_artist_name":      nilIfEmpty(stringValue(row["top_artist_name"])),
			"top_artist_photo_url": nilIfEmpty(topArtistPhotoURL),
		})
	}
	sort.SliceStable(items, func(i, j int) bool {
		left := items[i]
		right := items[j]
		if intValue(left["content_score"]) != intValue(right["content_score"]) {
			return intValue(left["content_score"]) > intValue(right["content_score"])
		}
		if genreRelationPriority[stringValue(left["relation_type"])] != genreRelationPriority[stringValue(right["relation_type"])] {
			return genreRelationPriority[stringValue(left["relation_type"])] > genreRelationPriority[stringValue(right["relation_type"])]
		}
		if intValue(left["artist_count"]) != intValue(right["artist_count"]) {
			return intValue(left["artist_count"]) > intValue(right["artist_count"])
		}
		if intValue(left["album_count"]) != intValue(right["album_count"]) {
			return intValue(left["album_count"]) > intValue(right["album_count"])
		}
		return stringValue(left["name"]) < stringValue(right["name"])
	})
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	return items
}

func nilIfEmpty(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nilIfZero(value int64) any {
	if value <= 0 {
		return nil
	}
	return value
}

func (s *Store) relatedGenres(ctx context.Context, canonicalSlug string, limit int) ([]map[string]any, error) {
	slug := strings.TrimSpace(canonicalSlug)
	if slug == "" {
		return []map[string]any{}, nil
	}
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(queryCtx, `
		WITH target AS (
			SELECT id, slug
			FROM genre_taxonomy_nodes
			WHERE slug = $1
			LIMIT 1
		),
		parent_ids AS (
			SELECT e.target_genre_id AS parent_id
			FROM genre_taxonomy_edges e
			JOIN target t ON t.id = e.source_genre_id
			WHERE e.relation_type = 'parent'
		),
		raw_relations AS (
			SELECT child.slug, 'child'::TEXT AS relation_type
			FROM genre_taxonomy_edges e
			JOIN target t ON t.id = e.target_genre_id
			JOIN genre_taxonomy_nodes child ON child.id = e.source_genre_id
			WHERE e.relation_type = 'parent'

			UNION ALL

			SELECT sibling.slug, 'sibling'::TEXT AS relation_type
			FROM parent_ids p
			JOIN genre_taxonomy_edges e
			  ON e.target_genre_id = p.parent_id
			 AND e.relation_type = 'parent'
			JOIN target t ON true
			JOIN genre_taxonomy_nodes sibling ON sibling.id = e.source_genre_id
			WHERE sibling.id != t.id

			UNION ALL

			SELECT related.slug, 'related'::TEXT AS relation_type
			FROM genre_taxonomy_edges e
			JOIN target t ON t.id = e.source_genre_id
			JOIN genre_taxonomy_nodes related ON related.id = e.target_genre_id
			WHERE e.relation_type = 'related'

			UNION ALL

			SELECT related.slug, 'related'::TEXT AS relation_type
			FROM genre_taxonomy_edges e
			JOIN target t ON t.id = e.target_genre_id
			JOIN genre_taxonomy_nodes related ON related.id = e.source_genre_id
			WHERE e.relation_type = 'related'

			UNION ALL

			SELECT influenced.slug, 'influenced_by'::TEXT AS relation_type
			FROM genre_taxonomy_edges e
			JOIN target t ON t.id = e.source_genre_id
			JOIN genre_taxonomy_nodes influenced ON influenced.id = e.target_genre_id
			WHERE e.relation_type = 'influenced_by'

			UNION ALL

			SELECT influenced.slug, 'influences'::TEXT AS relation_type
			FROM genre_taxonomy_edges e
			JOIN target t ON t.id = e.target_genre_id
			JOIN genre_taxonomy_nodes influenced ON influenced.id = e.source_genre_id
			WHERE e.relation_type = 'influenced_by'

			UNION ALL

			SELECT fusion.slug, 'fusion'::TEXT AS relation_type
			FROM genre_taxonomy_edges e
			JOIN target t ON t.id = e.target_genre_id
			JOIN genre_taxonomy_nodes fusion ON fusion.id = e.source_genre_id
			WHERE e.relation_type = 'fusion_of'
		),
		ranked_relations AS (
			SELECT
				slug,
				relation_type,
				ROW_NUMBER() OVER (
					PARTITION BY slug
					ORDER BY
						CASE relation_type
							WHEN 'child' THEN 60
							WHEN 'related' THEN 50
							WHEN 'sibling' THEN 40
							WHEN 'influenced_by' THEN 30
							WHEN 'influences' THEN 20
							WHEN 'fusion' THEN 10
							ELSE 0
						END DESC,
						slug ASC
				) AS relation_rank
			FROM raw_relations
			WHERE slug != $1
		),
		candidate_relations AS (
			SELECT slug, relation_type
			FROM ranked_relations
			WHERE relation_rank = 1
		)
		SELECT
			n.slug,
			n.name,
			n.description,
			n.external_description,
			n.cover_path AS canonical_cover_path,
			c.relation_type,
			COUNT(DISTINCT ag.artist_name)::BIGINT AS artist_count,
			COUNT(DISTINCT alg.album_id)::BIGINT AS album_count,
			page.page_slug,
			page.page_name,
			top_artist.top_artist_id,
			top_artist.top_artist_slug,
			top_artist.top_artist_name
		FROM candidate_relations c
		JOIN genre_taxonomy_nodes n ON n.slug = c.slug
		LEFT JOIN genre_taxonomy_aliases gta ON gta.genre_id = n.id
		LEFT JOIN genres g ON g.slug = gta.alias_slug
		LEFT JOIN artist_genres ag ON ag.genre_id = g.id
		LEFT JOIN album_genres alg ON alg.genre_id = g.id
		LEFT JOIN LATERAL (
			SELECT
				gp.slug AS page_slug,
				gp.name AS page_name
			FROM genre_taxonomy_aliases gta_page
			JOIN genres gp ON gp.slug = gta_page.alias_slug
			LEFT JOIN artist_genres ag_page ON ag_page.genre_id = gp.id
			LEFT JOIN album_genres alg_page ON alg_page.genre_id = gp.id
			WHERE gta_page.genre_id = n.id
			GROUP BY gp.id, gp.slug, gp.name
			ORDER BY
				COUNT(DISTINCT ag_page.artist_name) DESC,
				COUNT(DISTINCT alg_page.album_id) DESC,
				gp.slug ASC
			LIMIT 1
		) page ON true
		LEFT JOIN LATERAL (
			SELECT
				la.id AS top_artist_id,
				la.slug AS top_artist_slug,
				la.name AS top_artist_name
			FROM genre_taxonomy_aliases gta_artist
			JOIN genres ga ON ga.slug = gta_artist.alias_slug
			JOIN artist_genres ag_top ON ag_top.genre_id = ga.id
			JOIN library_artists la ON la.name = ag_top.artist_name
			WHERE gta_artist.genre_id = n.id
			  AND COALESCE(la.has_photo, 0) <> 0
			ORDER BY
				ag_top.weight DESC NULLS LAST,
				la.listeners DESC NULLS LAST,
				la.album_count DESC NULLS LAST,
				la.name ASC
			LIMIT 1
		) top_artist ON true
		GROUP BY
			n.id,
			n.slug,
			n.name,
			n.description,
			n.external_description,
			n.cover_path,
			c.relation_type,
			page.page_slug,
			page.page_name,
			top_artist.top_artist_id,
			top_artist.top_artist_slug,
			top_artist.top_artist_name
	`, slug))
	if err != nil {
		return nil, err
	}
	return buildRelatedGenrePayloads(rows, nil, limit), nil
}

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
	canonicalCoverPath := strings.TrimSpace(stringValue(row["canonical_cover_path"]))
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
		if canonicalCoverPath != "" {
			row["cover_url"] = genreCoverPublicURL(canonicalSlug)
		} else {
			row["cover_url"] = nil
		}
	} else {
		row["top_level_slug"] = nil
		row["top_level_name"] = nil
		row["top_level_description"] = nil
		row["description"] = nil
		row["cover_url"] = nil
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
	delete(row, "canonical_cover_path")
}

func genreCoverPublicURL(slug string) string {
	encodedSlug := url.PathEscape(strings.ToLower(strings.TrimSpace(slug)))
	return "/api/genres/" + encodedSlug + "/cover?size=640&format=webp"
}

func artistPhotoPublicURL(artistID int64) string {
	return "/api/artists/" + strconv.FormatInt(artistID, 10) + "/photo?size=640&format=webp"
}

func shouldUseStaticTopLevel(canonicalSlug string, currentTopLevelSlug string) bool {
	staticTopLevelSlug, ok := staticGenreTopLevel[canonicalSlug]
	if !ok || staticTopLevelSlug == "" || staticTopLevelSlug == canonicalSlug {
		return false
	}
	current := strings.TrimSpace(currentTopLevelSlug)
	return current == "" || current == canonicalSlug
}
