package catalog

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/sync/errgroup"
	"golang.org/x/text/unicode/norm"

	"github.com/thecrateapp/crate/app/readplane/internal/postgres"
)

var globalSearchFeatSuffix = regexp.MustCompile(`(?i)\s*[\(\[]?\s*(?:feat|ft|featuring)\.?\s+.+?[\)\]]?\s*$`)

// CatalogServingMode separates read availability from reconciliation progress.
type CatalogServingMode string

const (
	CatalogGlobalReady      CatalogServingMode = "global-ready"
	CatalogGlobalRefreshing CatalogServingMode = "global-refreshing"
	CatalogGlobalDegraded   CatalogServingMode = "global-degraded"
	CatalogLocalFallback    CatalogServingMode = "local-fallback"
)

// CatalogServingModeForState maps durable reconciliation state to read behavior.
func CatalogServingModeForState(status string, hasFullReconcile bool) CatalogServingMode {
	if status == "ready" {
		return CatalogGlobalReady
	}
	if hasFullReconcile {
		if status == "backfilling" {
			return CatalogGlobalRefreshing
		}
		return CatalogGlobalDegraded
	}
	return CatalogLocalFallback
}

// UsesGlobal reports whether canonical global rows should serve aggregate reads.
func (m CatalogServingMode) UsesGlobal() bool {
	return m != CatalogLocalFallback
}

// GlobalCatalogServingMode returns the read policy for the current catalog state.
func (s *Store) GlobalCatalogServingMode(ctx context.Context) (CatalogServingMode, error) {
	if s.globalCatalogServingModeFn != nil {
		return s.globalCatalogServingModeFn(ctx)
	}
	if s.pool == nil {
		return CatalogLocalFallback, fmt.Errorf("catalog database pool is unavailable")
	}
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	var status string
	var hasFullReconcile bool
	err := s.pool.QueryRow(ctx, `
		SELECT status, last_full_reconcile_at IS NOT NULL
		FROM global_catalog_state
		WHERE singleton = TRUE
	`).Scan(&status, &hasFullReconcile)
	if err != nil {
		return CatalogLocalFallback, err
	}
	return CatalogServingModeForState(status, hasFullReconcile), nil
}

// GlobalCatalogReady reports whether the canonical catalog can serve reads.
// A cold or backfilling catalog must never fall back to library_* rows.
func (s *Store) GlobalCatalogReady(ctx context.Context) (bool, error) {
	if s.globalCatalogReadyFn != nil {
		return s.globalCatalogReadyFn(ctx)
	}
	if s.pool == nil {
		return false, fmt.Errorf("catalog database pool is unavailable")
	}
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	var ready bool
	err := s.pool.QueryRow(ctx, `
		SELECT status = 'ready'
		FROM global_catalog_state
		WHERE singleton = TRUE
	`).Scan(&ready)
	if err != nil {
		return false, err
	}
	return ready, nil
}

// GlobalSearch reads the canonical node-first catalog. It deliberately never
// falls back to library_* tables: a zero-peer node is represented by its local
// sources in global_catalog_*.
func (s *Store) GlobalSearch(ctx context.Context, query string, limit int) (map[string]any, error) {
	if s.globalSearchFn != nil {
		return s.globalSearchFn(ctx, query, limit)
	}
	q := strings.TrimSpace(query)
	cappedLimit := clamp(limit, 1, 50)
	if utf8.RuneCountInString(q) < 2 {
		return map[string]any{"artists": []any{}, "albums": []any{}, "tracks": []any{}}, nil
	}
	like := "%" + escapeGlobalSearchLike(q) + "%"
	normalizedLike := "%" + escapeGlobalSearchLike(normalizeGlobalSearchQuery(q)) + "%"
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	documentRows, err := rowsToMaps(s.pool.Query(queryCtx, `
		WITH projection AS (
			SELECT status IN ('ready', 'refreshing', 'degraded') AS ready
			FROM global_catalog_search_projection_state
			WHERE singleton = true
		), ranked AS (
			SELECT document.entity_type, document.payload_json, true AS projection_ready,
			       ROW_NUMBER() OVER (
					PARTITION BY document.entity_type
					ORDER BY document.has_local DESC,
					         document.has_healthy_source DESC,
					         ts_rank_cd(document.search_vector, websearch_to_tsquery('simple', $1)) DESC,
					         similarity(document.search_text, $1) DESC,
					         document.source_count DESC,
					         document.search_text ASC
				) AS kind_rank
			FROM global_catalog_search_documents document
			CROSS JOIN projection
			WHERE projection.ready
			  AND (
				document.search_vector @@ websearch_to_tsquery('simple', $1)
				OR document.search_text ILIKE $2 ESCAPE '\\'
				OR document.normalized_text ILIKE $3 ESCAPE '\\'
			  )
		), combined AS (
			SELECT entity_type, payload_json, projection_ready, kind_rank,
			       false AS projection_row
			FROM ranked
			WHERE kind_rank <= $4
			UNION ALL
			SELECT '__projection__', '{}'::jsonb, COALESCE(ready, false), 0, true
			FROM projection
		)
		SELECT entity_type, payload_json, projection_ready
		FROM combined
		ORDER BY projection_row, entity_type, kind_rank
	`, q, like, normalizedLike, cappedLimit))
	if err == nil {
		if payload, ready := partitionGlobalSearchDocumentRows(documentRows); ready {
			return payload, nil
		}
	}
	return s.globalSearchLegacy(ctx, q, cappedLimit)
}

func (s *Store) globalSearchLegacy(ctx context.Context, q string, cappedLimit int) (map[string]any, error) {
	like := "%" + escapeGlobalSearchLike(q) + "%"
	normalizedLike := "%" + escapeGlobalSearchLike(normalizeGlobalSearchQuery(q)) + "%"
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()

	var artists []map[string]any
	var albums []map[string]any
	var tracks []map[string]any
	group, groupCtx := errgroup.WithContext(ctx)

	group.Go(func() error {
		var err error
		artists, err = rowsToMaps(s.pool.Query(groupCtx, `
			WITH source_health AS (
				SELECT global_entity_uid,
				       BOOL_OR(NOT source_stale AND source_deleted_at IS NULL) AS has_healthy_source
				FROM global_catalog_sources
				WHERE entity_type = 'artist'
				GROUP BY global_entity_uid
			)
			SELECT a.global_artist_uid::text AS global_artist_uid,
			       a.canonical_name,
			       a.local_artist_id,
			       a.local_artist_entity_uid::text AS local_artist_entity_uid,
			       a.availability_json, a.source_count, a.has_local, a.has_remote,
			       a.has_photo, COALESCE(sh.has_healthy_source, false) AS has_healthy_source
			FROM global_catalog_artists a
			LEFT JOIN source_health sh ON sh.global_entity_uid = a.global_artist_uid
			WHERE a.search_vector @@ plainto_tsquery('simple', $1)
			   OR a.canonical_name ILIKE $2 ESCAPE '\'
			   OR a.normalized_name ILIKE $3 ESCAPE '\'
			ORDER BY a.has_local DESC, COALESCE(sh.has_healthy_source, false) DESC,
			         a.source_count DESC, a.canonical_name ASC
			LIMIT $4
		`, q, like, normalizedLike, cappedLimit))
		if err != nil {
			return err
		}
		for index, artist := range artists {
			artists[index] = globalArtistSearchPayload(artist)
		}
		return nil
	})

	group.Go(func() error {
		var err error
		albums, err = rowsToMaps(s.pool.Query(groupCtx, `
			WITH source_health AS (
				SELECT global_entity_uid,
				       BOOL_OR(NOT source_stale AND source_deleted_at IS NULL) AS has_healthy_source
				FROM global_catalog_sources
				WHERE entity_type = 'album'
				GROUP BY global_entity_uid
			)
			SELECT a.global_album_uid::text AS global_album_uid,
			       a.global_artist_uid::text AS global_artist_uid,
			       a.canonical_name, a.artist_name, a.year, a.local_album_id,
			       a.local_album_entity_uid::text AS local_album_entity_uid,
			       a.availability_json, a.source_count, a.has_local, a.has_remote,
			       a.has_cover, COALESCE(sh.has_healthy_source, false) AS has_healthy_source
			FROM global_catalog_albums a
			LEFT JOIN source_health sh ON sh.global_entity_uid = a.global_album_uid
			WHERE a.search_vector @@ plainto_tsquery('simple', $1)
			   OR a.canonical_name ILIKE $2 ESCAPE '\' OR a.artist_name ILIKE $2 ESCAPE '\'
			   OR a.normalized_name ILIKE $3 ESCAPE '\'
			ORDER BY a.has_local DESC, COALESCE(sh.has_healthy_source, false) DESC,
			         a.source_count DESC, a.artist_name ASC, a.canonical_name ASC
			LIMIT $4
		`, q, like, normalizedLike, cappedLimit))
		if err != nil {
			return err
		}
		for index, album := range albums {
			albums[index] = globalAlbumSearchPayload(album)
		}
		return nil
	})

	group.Go(func() error {
		var err error
		tracks, err = rowsToMaps(s.pool.Query(groupCtx, `
			WITH source_health AS (
				SELECT global_entity_uid,
				       BOOL_OR(NOT source_stale AND source_deleted_at IS NULL) AS has_healthy_source
				FROM global_catalog_sources
				WHERE entity_type = 'track'
				GROUP BY global_entity_uid
			)
			SELECT t.global_track_uid::text AS global_track_uid,
			       t.global_album_uid::text AS global_album_uid,
			       t.global_artist_uid::text AS global_artist_uid,
			       t.canonical_title, t.artist_name, t.album_name, t.duration_seconds,
			       t.local_track_id, t.local_track_entity_uid::text AS local_track_entity_uid,
			       t.availability_json, t.source_count, t.has_local, t.has_remote,
			       COALESCE(sh.has_healthy_source, false) AS has_healthy_source
			FROM global_catalog_tracks t
			LEFT JOIN source_health sh ON sh.global_entity_uid = t.global_track_uid
			WHERE t.search_vector @@ plainto_tsquery('simple', $1)
			   OR t.canonical_title ILIKE $2 ESCAPE '\' OR t.artist_name ILIKE $2 ESCAPE '\' OR t.album_name ILIKE $2 ESCAPE '\'
			   OR t.normalized_title ILIKE $3 ESCAPE '\'
			ORDER BY t.has_local DESC, COALESCE(sh.has_healthy_source, false) DESC,
			         t.source_count DESC, t.artist_name ASC, t.canonical_title ASC
			LIMIT $4
		`, q, like, normalizedLike, cappedLimit))
		if err != nil {
			return err
		}
		for index, track := range tracks {
			tracks[index] = globalTrackSearchPayload(track)
		}
		return nil
	})

	if err := group.Wait(); err != nil {
		return nil, err
	}
	return map[string]any{"artists": artists, "albums": albums, "tracks": tracks}, nil
}

func partitionGlobalSearchDocumentRows(rows []map[string]any) (map[string]any, bool) {
	artists := []map[string]any{}
	albums := []map[string]any{}
	tracks := []map[string]any{}
	ready := false
	for _, row := range rows {
		entityType := stringValue(row["entity_type"])
		if entityType == "__projection__" {
			ready = boolValue(row["projection_ready"])
			continue
		}
		payload, ok := row["payload_json"].(map[string]any)
		if !ok {
			continue
		}
		switch entityType {
		case "artist":
			artists = append(artists, cloneMap(payload))
		case "album":
			albums = append(albums, cloneMap(payload))
		case "track":
			tracks = append(tracks, cloneMap(payload))
		}
	}
	return map[string]any{"artists": artists, "albums": albums, "tracks": tracks}, ready
}

// CanonicalSearch selects the newest complete read model without making search
// availability depend on reconciliation progress.
func (s *Store) CanonicalSearch(
	ctx context.Context,
	query string,
	limit int,
) (map[string]any, CatalogServingMode, error) {
	mode, err := s.GlobalCatalogServingMode(ctx)
	if err != nil {
		mode = CatalogLocalFallback
	}
	if mode.UsesGlobal() {
		payload, searchErr := s.GlobalSearch(ctx, query, limit)
		return payload, mode, searchErr
	}
	payload, searchErr := s.Search(ctx, query, limit)
	return payload, mode, searchErr
}

func normalizeGlobalSearchQuery(query string) string {
	query = globalSearchFeatSuffix.ReplaceAllString(strings.TrimSpace(query), "")
	query = strings.ReplaceAll(query, "&", " and ")
	var normalized strings.Builder
	for _, character := range norm.NFD.String(query) {
		if unicode.Is(unicode.Mn, character) || character > unicode.MaxASCII {
			continue
		}
		if unicode.IsLetter(character) || unicode.IsDigit(character) {
			normalized.WriteRune(unicode.ToLower(character))
		} else {
			normalized.WriteByte(' ')
		}
	}
	return strings.Join(strings.Fields(normalized.String()), " ")
}

func escapeGlobalSearchLike(query string) string {
	replacer := strings.NewReplacer(
		"\\", "\\\\",
		"%", "\\%",
		"_", "\\_",
	)
	return replacer.Replace(query)
}

func globalArtistSearchPayload(row map[string]any) map[string]any {
	slug := slugify(stringValue(row["canonical_name"]))
	if slug == "" {
		slug = "artist"
	}
	payload := map[string]any{
		"global_uid":        row["global_artist_uid"],
		"global_artist_uid": row["global_artist_uid"],
		"slug":              slug,
		"name":              row["canonical_name"],
		"has_photo":         boolValue(row["has_photo"]),
		"availability":      globalSearchAvailability(row),
	}
	if row["local_artist_id"] != nil {
		payload["id"] = row["local_artist_id"]
	}
	if row["local_artist_entity_uid"] != nil {
		payload["entity_uid"] = row["local_artist_entity_uid"]
		payload["local_artist_entity_uid"] = row["local_artist_entity_uid"]
	}
	return payload
}

func globalAlbumSearchPayload(row map[string]any) map[string]any {
	slug := slugify(stringValue(row["canonical_name"]))
	if slug == "" {
		slug = "album"
	}
	artistSlug := slugify(stringValue(row["artist_name"]))
	if artistSlug == "" {
		artistSlug = "artist"
	}
	payload := map[string]any{
		"global_uid":        row["global_album_uid"],
		"global_album_uid":  row["global_album_uid"],
		"global_artist_uid": row["global_artist_uid"],
		"slug":              slug,
		"artist_slug":       artistSlug,
		"artist":            row["artist_name"],
		"name":              row["canonical_name"],
		"display_name":      row["canonical_name"],
		"year":              row["year"],
		"tracks":            intValue(row["track_count"]),
		"formats":           []any{},
		"size_mb":           0,
		"has_cover":         boolValue(row["has_cover"]),
		"availability":      globalSearchAvailability(row),
	}
	if row["local_album_id"] != nil {
		payload["id"] = row["local_album_id"]
	}
	if row["local_album_entity_uid"] != nil {
		payload["entity_uid"] = row["local_album_entity_uid"]
		payload["local_album_entity_uid"] = row["local_album_entity_uid"]
	}
	if row["year"] == nil {
		delete(payload, "year")
	}
	return payload
}

func globalTrackSearchPayload(row map[string]any) map[string]any {
	payload := map[string]any{
		"global_uid":        row["global_track_uid"],
		"global_track_uid":  row["global_track_uid"],
		"globalTrackUid":    row["global_track_uid"],
		"global_artist_uid": row["global_artist_uid"],
		"title":             row["canonical_title"],
		"artist":            row["artist_name"],
		"album":             row["album_name"],
		"duration":          row["duration_seconds"],
		"availability":      globalSearchAvailability(row),
	}
	if row["global_album_uid"] != nil {
		payload["global_album_uid"] = row["global_album_uid"]
	}
	if row["local_track_id"] != nil {
		payload["id"] = row["local_track_id"]
	}
	if row["local_track_entity_uid"] != nil {
		payload["entity_uid"] = row["local_track_entity_uid"]
	}
	if row["duration_seconds"] == nil {
		delete(payload, "duration")
	}
	return payload
}

func globalSearchAvailability(row map[string]any) map[string]any {
	availability := map[string]any{}
	if raw, ok := row["availability_json"].(map[string]any); ok {
		availability = cloneMap(raw)
	}
	availability["local"] = boolValue(row["has_local"])
	availability["remote"] = boolValue(row["has_remote"])
	availability["healthy"] = boolValue(row["has_healthy_source"])
	return availability
}
