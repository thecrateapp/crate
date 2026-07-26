package catalog

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/sync/errgroup"

	"github.com/thecrateapp/crate/app/readplane/internal/postgres"
)

var ErrNotFound = errors.New("catalog item not found")

const userLibraryCountsQuery = `
		SELECT
			(
				(SELECT COUNT(*) FROM user_global_artist_follows WHERE user_id = $1)
				+
				(
					SELECT COUNT(*)
					FROM user_follows uf
					LEFT JOIN library_artists local_artist
					  ON lower(local_artist.name) = lower(uf.artist_name)
					LEFT JOIN global_catalog_artists global_artist
					  ON global_artist.local_artist_id = local_artist.id
					LEFT JOIN user_global_artist_follows projected
					  ON projected.user_id = uf.user_id
					 AND projected.global_artist_uid = global_artist.global_artist_uid
					WHERE uf.user_id = $1
					  AND projected.user_id IS NULL
				)
			)::INTEGER AS followed_artists,
			(
				(SELECT COUNT(*) FROM user_global_album_saves WHERE user_id = $1)
				+
				(
					SELECT COUNT(*)
					FROM user_saved_albums usa
					LEFT JOIN global_catalog_albums global_album
					  ON global_album.local_album_id = usa.album_id
					LEFT JOIN user_global_album_saves projected
					  ON projected.user_id = usa.user_id
					 AND projected.global_album_uid = global_album.global_album_uid
					WHERE usa.user_id = $1
					  AND projected.user_id IS NULL
				)
			)::INTEGER AS saved_albums,
			(SELECT COUNT(*) FROM user_liked_tracks WHERE user_id = $1)::INTEGER AS liked_tracks,
			(SELECT COUNT(*) FROM playlists WHERE user_id = $1)::INTEGER AS playlists
	`

const followedArtistsQuery = `
		WITH canonical AS (
			SELECT
				a.canonical_name AS artist_name,
				f.created_at,
				a.local_artist_id AS artist_id,
				a.local_artist_entity_uid::text AS artist_entity_uid,
				la.slug AS artist_slug,
				COALESCE(album_counts.album_count, 0)::INTEGER AS album_count,
				COALESCE(track_counts.track_count, 0)::INTEGER AS track_count,
				a.has_photo,
				a.global_artist_uid::text AS global_artist_uid,
				CASE WHEN a.has_photo THEN
					'/api/catalog/artists/' || a.global_artist_uid::text || '/photo'
				ELSE NULL END AS photo_url
			FROM user_global_artist_follows f
			JOIN global_catalog_artists a ON a.global_artist_uid = f.global_artist_uid
			LEFT JOIN library_artists la ON la.id = a.local_artist_id
			LEFT JOIN (
				SELECT global_artist_uid, COUNT(*) AS album_count
				FROM global_catalog_albums
				GROUP BY global_artist_uid
			) album_counts ON album_counts.global_artist_uid = a.global_artist_uid
			LEFT JOIN (
				SELECT global_artist_uid, COUNT(*) AS track_count
				FROM global_catalog_tracks
				GROUP BY global_artist_uid
			) track_counts ON track_counts.global_artist_uid = a.global_artist_uid
			WHERE f.user_id = $1
		), legacy_only AS (
			SELECT
				uf.artist_name,
				uf.created_at,
				local_artist.id AS artist_id,
				local_artist.entity_uid::text AS artist_entity_uid,
				local_artist.slug AS artist_slug,
				COALESCE(local_artist.album_count, 0)::INTEGER AS album_count,
				COALESCE(local_artist.track_count, 0)::INTEGER AS track_count,
				(COALESCE(local_artist.has_photo, 0) != 0) AS has_photo,
				NULL::text AS global_artist_uid,
				NULL::text AS photo_url
			FROM user_follows uf
			LEFT JOIN library_artists local_artist
			  ON lower(local_artist.name) = lower(uf.artist_name)
			LEFT JOIN global_catalog_artists global_artist
			  ON global_artist.local_artist_id = local_artist.id
			LEFT JOIN user_global_artist_follows projected
			  ON projected.user_id = uf.user_id
			 AND projected.global_artist_uid = global_artist.global_artist_uid
			WHERE uf.user_id = $1
			  AND projected.user_id IS NULL
		)
		SELECT * FROM canonical
		UNION ALL
		SELECT * FROM legacy_only
		ORDER BY created_at DESC
	`

const savedAlbumsQuery = `
		WITH canonical AS (
			SELECT
				s.created_at AS saved_at,
				a.local_album_id AS id,
				a.global_album_uid::text AS global_album_uid,
				a.global_artist_uid::text AS global_artist_uid,
				a.local_album_entity_uid::text AS album_entity_uid,
				la.slug,
				a.artist_name AS artist,
				art.local_artist_id AS artist_id,
				art.local_artist_entity_uid::text AS artist_entity_uid,
				lar.slug AS artist_slug,
				a.canonical_name AS name,
				a.year,
				a.has_cover,
				COALESCE(a.track_count, 0)::INTEGER AS track_count,
				COALESCE(a.total_duration_seconds, 0) AS total_duration,
				CASE WHEN a.has_cover THEN
					'/api/catalog/albums/' || a.global_album_uid::text || '/cover'
				ELSE NULL END AS cover_url
			FROM user_global_album_saves s
			JOIN global_catalog_albums a ON a.global_album_uid = s.global_album_uid
			LEFT JOIN library_albums la ON la.id = a.local_album_id
			LEFT JOIN global_catalog_artists art ON art.global_artist_uid = a.global_artist_uid
			LEFT JOIN library_artists lar ON lar.id = art.local_artist_id
			WHERE s.user_id = $1
		), legacy_only AS (
			SELECT
				usa.created_at AS saved_at,
				local_album.id,
				NULL::text AS global_album_uid,
				NULL::text AS global_artist_uid,
				local_album.entity_uid::text AS album_entity_uid,
				local_album.slug,
				local_album.artist,
				local_artist.id AS artist_id,
				local_artist.entity_uid::text AS artist_entity_uid,
				local_artist.slug AS artist_slug,
				local_album.name,
				local_album.year,
				(COALESCE(local_album.has_cover, 0) != 0) AS has_cover,
				COALESCE(local_album.track_count, 0)::INTEGER AS track_count,
				COALESCE(local_album.total_duration, 0) AS total_duration,
				NULL::text AS cover_url
			FROM user_saved_albums usa
			JOIN library_albums local_album ON local_album.id = usa.album_id
			LEFT JOIN library_artists local_artist ON local_artist.name = local_album.artist
			LEFT JOIN global_catalog_albums global_album
			  ON global_album.local_album_id = usa.album_id
			LEFT JOIN user_global_album_saves projected
			  ON projected.user_id = usa.user_id
			 AND projected.global_album_uid = global_album.global_album_uid
			WHERE usa.user_id = $1
			  AND projected.user_id IS NULL
		)
		SELECT * FROM canonical
		UNION ALL
		SELECT * FROM legacy_only
		ORDER BY saved_at DESC
	`

const followingArtistNameQuery = `
		SELECT 1
		FROM user_global_artist_follows followed
		JOIN global_catalog_artists artist
		  ON artist.global_artist_uid = followed.global_artist_uid
		WHERE followed.user_id = $1
		  AND lower(artist.canonical_name) = lower($2)
		UNION ALL
		SELECT 1
		FROM user_follows
		WHERE user_id = $1
		  AND lower(artist_name) = lower($2)
		LIMIT 1
	`

const localArtistSearchSQL = `
	WITH fts_candidates AS (
		SELECT id
		FROM library_artists
		WHERE NULLIF($1, '') IS NOT NULL
		  AND search_vector @@ to_tsquery('simple', $1)
		ORDER BY ts_rank(search_vector, to_tsquery('simple', $1)) DESC, id
		LIMIT $4
	), substring_candidates AS (
		SELECT id
		FROM library_artists
		WHERE name ILIKE $2 ESCAPE '\'
		ORDER BY CASE WHEN name ILIKE $3 ESCAPE '\' THEN 0 ELSE 1 END, id
		LIMIT $4
	), candidates AS (
		SELECT id FROM fts_candidates
		UNION
		SELECT id FROM substring_candidates
	), ranked AS (
		SELECT a.id, a.entity_uid::text AS entity_uid, a.slug, a.name,
		       a.album_count, a.has_photo,
		       COALESCE(ts_rank(a.search_vector, to_tsquery('simple', NULLIF($1, ''))), 0) AS fts_rank,
		       CASE WHEN a.name ILIKE $3 ESCAPE '\' THEN 0.3 ELSE 0 END AS prefix_bonus,
		       CASE WHEN a.name ILIKE $2 ESCAPE '\' THEN 0.15 ELSE 0 END AS substring_bonus
		FROM candidates c
		JOIN library_artists a ON a.id = c.id
	)
	SELECT id, entity_uid, slug, name, album_count, has_photo
	FROM ranked
	ORDER BY (fts_rank + prefix_bonus + substring_bonus) DESC, album_count DESC, name ASC
	LIMIT $5
`

const localAlbumSearchSQL = `
	WITH fts_candidates AS (
		SELECT id
		FROM library_albums
		WHERE NULLIF($1, '') IS NOT NULL
		  AND search_vector @@ to_tsquery('simple', $1)
		ORDER BY ts_rank(search_vector, to_tsquery('simple', $1)) DESC, id
		LIMIT $4
	), substring_candidates AS (
		SELECT id
		FROM library_albums
		WHERE name ILIKE $2 ESCAPE '\'
		   OR artist ILIKE $2 ESCAPE '\'
		ORDER BY CASE
			WHEN name ILIKE $3 ESCAPE '\' THEN 0
			WHEN artist ILIKE $3 ESCAPE '\' THEN 1
			ELSE 2
		END, id
		LIMIT $4
	), candidates AS (
		SELECT id FROM fts_candidates
		UNION
		SELECT id FROM substring_candidates
	), ranked AS (
		SELECT a.id, a.entity_uid::text AS entity_uid, a.slug,
		       a.artist, a.name, a.year, a.has_cover,
		       ar.id AS artist_id,
		       ar.entity_uid::text AS artist_entity_uid,
		       ar.slug AS artist_slug,
		       COALESCE(ts_rank(a.search_vector, to_tsquery('simple', NULLIF($1, ''))), 0) AS fts_rank,
		       CASE WHEN a.name ILIKE $3 ESCAPE '\' THEN 0.3
		            WHEN a.artist ILIKE $3 ESCAPE '\' THEN 0.2
		            ELSE 0 END AS prefix_bonus,
		       CASE WHEN a.name ILIKE $2 ESCAPE '\' THEN 0.15
		            WHEN a.artist ILIKE $2 ESCAPE '\' THEN 0.1
		            ELSE 0 END AS substring_bonus
		FROM candidates c
		JOIN library_albums a ON a.id = c.id
		LEFT JOIN library_artists ar ON ar.name = a.artist
	)
	SELECT id, entity_uid, slug, artist, name, year, has_cover,
	       artist_id, artist_entity_uid, artist_slug
	FROM ranked
	ORDER BY (fts_rank + prefix_bonus + substring_bonus) DESC, year DESC NULLS LAST, name ASC
	LIMIT $5
`

const localTrackSearchSQL = `
	WITH fts_candidates AS (
		SELECT id
		FROM library_tracks
		WHERE NULLIF($1, '') IS NOT NULL
		  AND search_vector @@ to_tsquery('simple', $1)
		ORDER BY ts_rank(search_vector, to_tsquery('simple', $1)) DESC, id
		LIMIT $4
	), substring_candidates AS (
		SELECT id
		FROM library_tracks t
		WHERE t.title ILIKE $2 ESCAPE '\'
		   OR t.artist ILIKE $2 ESCAPE '\'
		   OR t.album ILIKE $2 ESCAPE '\'
		ORDER BY CASE
			WHEN t.title ILIKE $3 ESCAPE '\' THEN 0
			WHEN t.artist ILIKE $3 ESCAPE '\' THEN 1
			WHEN t.album ILIKE $3 ESCAPE '\' THEN 2
			ELSE 3
		END, id
		LIMIT $4
	), candidates AS (
		SELECT id FROM fts_candidates
		UNION
		SELECT id FROM substring_candidates
	), ranked AS (
		SELECT t.id, t.entity_uid::text AS entity_uid, t.slug, t.title, t.artist,
		       ar.id AS artist_id, ar.entity_uid::text AS artist_entity_uid, ar.slug AS artist_slug,
		       a.id AS album_id, a.entity_uid::text AS album_entity_uid, a.slug AS album_slug,
		       a.name AS album, t.path, t.duration,
		       COALESCE(ts_rank(t.search_vector, to_tsquery('simple', NULLIF($1, ''))), 0) AS fts_rank,
		       CASE WHEN t.title ILIKE $3 ESCAPE '\' THEN 0.3
		            WHEN t.artist ILIKE $3 ESCAPE '\' THEN 0.2
		            WHEN t.album ILIKE $3 ESCAPE '\' THEN 0.1
		            ELSE 0 END AS prefix_bonus,
		       CASE WHEN t.title ILIKE $2 ESCAPE '\' THEN 0.15
		            WHEN t.artist ILIKE $2 ESCAPE '\' THEN 0.1
		            WHEN t.album ILIKE $2 ESCAPE '\' THEN 0.05
		            ELSE 0 END AS substring_bonus
		FROM candidates c
		JOIN library_tracks t ON t.id = c.id
		JOIN library_albums a ON t.album_id = a.id
		LEFT JOIN library_artists ar ON ar.name = t.artist
	)
	SELECT id, entity_uid, slug, title, artist,
	       artist_id, artist_entity_uid, artist_slug,
	       album_id, album_entity_uid, album_slug, album, path, duration
	FROM ranked
	ORDER BY (fts_rank + prefix_bonus + substring_bonus) DESC, title ASC
	LIMIT $5
`

// Store provides read-only catalog queries backed by a PostgreSQL pool.
type Store struct {
	pool                       *pgxpool.Pool
	queryTimeout               time.Duration
	globalCatalogReadyFn       func(context.Context) (bool, error)
	globalCatalogServingModeFn func(context.Context) (CatalogServingMode, error)
	localSearchFn              func(context.Context, string, int) (map[string]any, error)
	globalSearchFn             func(context.Context, string, int) (map[string]any, error)
	artistRowFn                func(context.Context, string, ...any) (map[string]any, error)
	artistTopTracksFn          func(context.Context, string, int) ([]map[string]any, error)
}

type historyFallbackRef struct {
	index  int
	artist string
	title  string
}

// NewStore creates a catalog Store with the given connection pool and query timeout.
func NewStore(pool *pgxpool.Pool, queryTimeout time.Duration) *Store {
	return &Store{pool: pool, queryTimeout: queryTimeout}
}

// Search runs parallel artist, album, and track queries for the given search text.
func (s *Store) Search(ctx context.Context, query string, limit int) (map[string]any, error) {
	if s.localSearchFn != nil {
		return s.localSearchFn(ctx, query, limit)
	}
	q := strings.TrimSpace(query)
	cappedLimit := clamp(limit, 1, 50)
	if utf8.RuneCountInString(q) < 2 {
		return map[string]any{"artists": []any{}, "albums": []any{}, "tracks": []any{}}, nil
	}
	ftsQuery := buildLocalFTSQuery(q)
	escaped := escapeLocalSearchLike(q)
	substring := "%" + escaped + "%"
	prefix := escaped + "%"
	candidateLimit := clamp(cappedLimit*20, 100, 1000)
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()

	var artists []map[string]any
	var albums []map[string]any
	var tracks []map[string]any

	g, gCtx := errgroup.WithContext(ctx)

	g.Go(func() error {
		var err error
		artists, err = rowsToMaps(s.pool.Query(
			gCtx, localArtistSearchSQL, ftsQuery, substring, prefix, candidateLimit, cappedLimit,
		))
		if err != nil {
			return err
		}
		for _, artist := range artists {
			artist["has_photo"] = boolValue(artist["has_photo"])
		}
		return nil
	})

	g.Go(func() error {
		var err error
		albums, err = rowsToMaps(s.pool.Query(
			gCtx, localAlbumSearchSQL, ftsQuery, substring, prefix, candidateLimit, cappedLimit,
		))
		if err != nil {
			return err
		}
		for _, album := range albums {
			if album["year"] == nil {
				album["year"] = ""
			}
			album["has_cover"] = boolValue(album["has_cover"])
		}
		return nil
	})

	g.Go(func() error {
		var err error
		tracks, err = rowsToMaps(s.pool.Query(
			gCtx, localTrackSearchSQL, ftsQuery, substring, prefix, candidateLimit, cappedLimit,
		))
		if err != nil {
			return err
		}
		for _, track := range tracks {
			track["bpm"] = nil
			track["audio_key"] = nil
			track["audio_scale"] = nil
			track["energy"] = nil
			track["danceability"] = nil
			track["valence"] = nil
			track["bliss_vector"] = nil
		}
		return nil
	})

	if err := g.Wait(); err != nil {
		return nil, err
	}
	return map[string]any{
		"artists": artists,
		"albums":  albums,
		"tracks":  tracks,
	}, nil
}

func buildLocalFTSQuery(query string) string {
	terms := strings.FieldsFunc(strings.TrimSpace(query), func(character rune) bool {
		return !unicode.IsLetter(character) && !unicode.IsDigit(character) && character != '_'
	})
	if len(terms) == 0 {
		return ""
	}
	for index, term := range terms {
		terms[index] = strings.ToLower(term)
	}
	terms[len(terms)-1] += ":*"
	return strings.Join(terms, " & ")
}

func escapeLocalSearchLike(query string) string {
	return strings.NewReplacer(
		`\`, `\\`,
		`%`, `\%`,
		`_`, `\_`,
	).Replace(query)
}

// Favorites returns all favorited items ordered by creation time.
func (s *Store) Favorites(ctx context.Context) (map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	items, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT item_type, item_id, created_at
		FROM favorites
		ORDER BY created_at DESC
	`))
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

// FollowedArtists returns the artists followed by the given user.
func (s *Store) FollowedArtists(ctx context.Context, userID int64) ([]map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	return rowsToMaps(s.pool.Query(ctx, followedArtistsQuery, userID))
}

// SavedAlbums returns the albums saved by the given user.
func (s *Store) SavedAlbums(ctx context.Context, userID int64) ([]map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	return rowsToMaps(s.pool.Query(ctx, savedAlbumsQuery, userID))
}

// LikedTracks returns the tracks liked by the given user, newest first.
func (s *Store) LikedTracks(ctx context.Context, userID int64, limit int) ([]map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT
			ult.track_id,
			lt.entity_uid::text AS track_entity_uid,
			ult.created_at AS liked_at,
			lt.path,
			lt.title,
			lt.artist,
			ar.id AS artist_id,
			ar.entity_uid::text AS artist_entity_uid,
			ar.slug AS artist_slug,
			lt.album,
			alb.id AS album_id,
			alb.entity_uid::text AS album_entity_uid,
			alb.slug AS album_slug,
			lt.duration,
			lt.bpm,
			lt.audio_key,
			lt.audio_scale,
			lt.energy,
			lt.danceability,
			lt.valence,
			lt.bliss_vector
		FROM user_liked_tracks ult
		JOIN library_tracks lt ON lt.id = ult.track_id
		LEFT JOIN library_albums alb ON alb.id = lt.album_id
		LEFT JOIN library_artists ar ON ar.name = lt.artist
		WHERE ult.user_id = $1
		ORDER BY ult.created_at DESC
		LIMIT $2
	`, userID, limit))
	if err != nil {
		return nil, err
	}
	for _, item := range rows {
		item["relative_path"] = relativeMusicPath(stringValue(item["path"]))
		item["bliss_vector"] = normalizeFloatSlice(item["bliss_vector"])
	}
	return rows, nil
}

// UserLibraryCounts returns aggregate counts for the user's library activity.
func (s *Store) UserLibraryCounts(ctx context.Context, userID int64) (map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, userLibraryCountsQuery, userID))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return map[string]any{}, nil
	}
	return rows[0], nil
}

// IsFollowingArtistName reports whether the user follows the given artist name.
func (s *Store) IsFollowingArtistName(ctx context.Context, userID int64, artistName string) (map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, followingArtistNameQuery, userID, artistName))
	if err != nil {
		return nil, err
	}
	return map[string]any{"following": len(rows) > 0}, nil
}

// IsFollowingArtistID reports whether the user follows the given artist ID.
func (s *Store) IsFollowingArtistID(ctx context.Context, userID int64, artistID int64) (map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT name
		FROM library_artists
		WHERE id = $1
		LIMIT 1
	`, artistID))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return s.IsFollowingArtistName(ctx, userID, stringValue(rows[0]["name"]))
}

// PlayHistory returns the user's recent play events with resolved track metadata.
func (s *Store) PlayHistory(ctx context.Context, userID int64, limit int) ([]map[string]any, error) {
	hasLegacyStreamID, err := s.hasLegacyStreamIDColumn(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := s.playHistoryRows(ctx, userID, limit, hasLegacyStreamID)
	if err != nil {
		return nil, err
	}

	needsFallback := []historyFallbackRef{}
	for index, item := range rows {
		item["relative_path"] = relativeMusicPath(stringValue(item["track_path"]))
		if item["album_id"] == nil && stringValue(item["artist"]) != "" && stringValue(item["title"]) != "" {
			needsFallback = append(needsFallback, historyFallbackRef{
				index:  index,
				artist: stringValue(item["artist"]),
				title:  stringValue(item["title"]),
			})
		}
	}
	resolved, err := s.resolvePlayHistoryAlbumFallback(ctx, needsFallback)
	if err != nil {
		return nil, err
	}
	for _, pending := range needsFallback {
		hit := resolved[historyFallbackKey(pending.artist, pending.title)]
		if hit == nil {
			continue
		}
		item := rows[pending.index]
		item["track_id"] = hit["track_id"]
		item["track_entity_uid"] = hit["track_entity_uid"]
		if item["track_path"] == nil || stringValue(item["track_path"]) == "" {
			item["track_path"] = hit["path"]
		}
		if stringValue(hit["artist"]) != "" {
			item["artist"] = hit["artist"]
		}
		item["album_id"] = hit["album_id"]
		item["album_entity_uid"] = hit["album_entity_uid"]
		item["album_slug"] = hit["album_slug"]
		if item["album"] == nil || stringValue(item["album"]) == "" {
			item["album"] = hit["album"]
		}
		if item["artist_id"] == nil {
			item["artist_id"] = hit["artist_id"]
		}
		if item["artist_entity_uid"] == nil {
			item["artist_entity_uid"] = hit["artist_entity_uid"]
		}
		if item["artist_slug"] == nil {
			item["artist_slug"] = hit["artist_slug"]
		}
	}
	return rows, nil
}

var genresSQL = `
		WITH artist_counts AS (
			SELECT
				genre_id,
				COUNT(DISTINCT artist_name)::INTEGER AS artist_count
			FROM artist_genres
			GROUP BY genre_id
		),
		album_counts AS (
			SELECT
				genre_id,
				COUNT(DISTINCT album_id)::INTEGER AS album_count
			FROM album_genres
			GROUP BY genre_id
		)
		SELECT
			g.id,
			g.entity_uid::text AS entity_uid,
			g.name,
			g.slug,
			COALESCE(ac.artist_count, 0) AS artist_count,
			COALESCE(alc.album_count, 0) AS album_count,
			tn.slug AS canonical_slug,
			tn.name AS canonical_name,
			tn.description AS canonical_description,
			tn.external_description,
			tn.external_description_source,
			tn.cover_path AS canonical_cover_path,
			tn.musicbrainz_mbid,
			tn.wikidata_entity_id,
			tn.wikidata_url,
			tl.slug AS top_level_slug,
			tl.name AS top_level_name,
			tl.description AS top_level_description
		FROM genres g
		LEFT JOIN artist_counts ac ON ac.genre_id = g.id
		LEFT JOIN album_counts alc ON alc.genre_id = g.id
		LEFT JOIN genre_taxonomy_aliases gta
		  ON gta.alias_slug = g.slug OR lower(trim(gta.alias_name)) = lower(trim(g.name))
		LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
		LEFT JOIN LATERAL (` + genreTopLevelSQL("tn.slug") + `) tl ON tn.slug IS NOT NULL
		WHERE COALESCE(ac.artist_count, 0) > 0
		   OR COALESCE(alc.album_count, 0) > 0
		ORDER BY COALESCE(ac.artist_count, 0) DESC
	`

// Genres returns all genres with artist/album counts and taxonomy metadata.
func (s *Store) Genres(ctx context.Context) ([]map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, genresSQL))
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		annotateGenreSummary(row, false)
	}
	return rows, nil
}

// GenreDetail returns a single genre summary with its artists, albums, and user-local shows.
func (s *Store) GenreDetail(ctx context.Context, slug string, userID int64) (map[string]any, error) {
	summary, err := s.genreSummaryBySlug(ctx, slug)
	if err != nil {
		return nil, err
	}
	if stringValue(summary["description"]) == "" && !boolValue(summary["mapped"]) {
		summary["description"] = "raw library tag detected in your collection but not yet linked into the curated taxonomy."
	}
	genreID := intValue(summary["id"])
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()

	artists, err := rowsToMaps(s.pool.Query(queryCtx, `
		WITH target_genres AS (
			SELECT $1::BIGINT AS id
		),
		artist_memberships AS (
			SELECT
				ag.artist_name,
				ag.genre_id,
				ag.weight::DOUBLE PRECISION AS weight,
				ag.weight::DOUBLE PRECISION AS membership_score,
				ag.source
			FROM artist_genres ag
			WHERE ag.genre_id IN (SELECT id FROM target_genres)
		)
		SELECT
			ag.artist_name,
			la.id AS artist_id,
			la.slug AS artist_slug,
			ag.weight,
			ag.source,
			la.album_count,
			la.track_count,
			la.has_photo,
			la.spotify_popularity,
			la.listeners,
			ag.membership_score
		FROM artist_memberships ag
		JOIN library_artists la ON ag.artist_name = la.name
		WHERE ag.membership_score >= $2
		ORDER BY
			CASE
				WHEN ag.membership_score >= 0.90 THEN 3
				WHEN ag.membership_score >= 0.70 THEN 2
				WHEN ag.membership_score >= $2 THEN 1
				ELSE 0
			END DESC,
			ag.weight DESC NULLS LAST,
			la.listeners DESC NULLS LAST,
			la.spotify_popularity DESC NULLS LAST,
			la.album_count DESC NULLS LAST,
			ag.artist_name ASC
	`, genreID, minArtistRoomMembershipScore))
	if err != nil {
		return nil, err
	}
	annotateGenreMembershipRows(artists)
	albums, err := rowsToMaps(s.pool.Query(queryCtx, `
		WITH target_genres AS (
			SELECT $1::BIGINT AS id
		),
		artist_memberships AS (
			SELECT
				ag.artist_name,
				ag.genre_id,
				ag.weight::DOUBLE PRECISION AS weight,
				ag.weight::DOUBLE PRECISION AS membership_score,
				ag.source
			FROM artist_genres ag
			WHERE ag.genre_id IN (SELECT id FROM target_genres)
		),
		album_genre_weights AS (
			SELECT album_id, MAX(weight)::DOUBLE PRECISION AS weight
			FROM album_genres
			WHERE genre_id IN (SELECT id FROM target_genres)
			GROUP BY album_id
		),
		album_memberships AS (
			SELECT
				a.id AS album_id,
				a.slug AS album_slug,
				a.artist,
				ar.id AS artist_id,
				ar.slug AS artist_slug,
				a.name,
				a.year,
				a.track_count,
				a.has_cover,
				a.popularity,
				a.lastfm_playcount,
				ar.listeners,
				ar.spotify_popularity,
				GREATEST(
					COALESCE(alg.weight, 0.0),
					COALESCE(pa.membership_score, 0.0) * $3
				)::DOUBLE PRECISION AS membership_score,
				(alg.album_id IS NOT NULL) AS direct_genre_match
			FROM library_albums a
			LEFT JOIN artist_memberships pa ON pa.artist_name = a.artist
			LEFT JOIN library_artists ar ON ar.name = a.artist
			LEFT JOIN album_genre_weights alg ON alg.album_id = a.id
			WHERE alg.album_id IS NOT NULL
			   OR pa.membership_score >= $2
		)
		SELECT
			album_id,
			album_slug,
			artist,
			artist_id,
			artist_slug,
			name,
			year,
			track_count,
			has_cover,
			membership_score AS weight,
			membership_score,
			direct_genre_match
		FROM album_memberships
		WHERE membership_score >= $2
		ORDER BY
			CASE
				WHEN membership_score >= 0.90 THEN 3
				WHEN membership_score >= 0.70 THEN 2
				WHEN membership_score >= $2 THEN 1
				ELSE 0
			END DESC,
			direct_genre_match DESC,
			membership_score DESC NULLS LAST,
			COALESCE(popularity, 0) DESC NULLS LAST,
			COALESCE(lastfm_playcount, 0) DESC NULLS LAST,
			listeners DESC NULLS LAST,
			spotify_popularity DESC NULLS LAST,
			year DESC NULLS LAST,
			name ASC
		`, genreID, minGenreMembershipScore, artistAlbumFallbackScore))
	if err != nil {
		return nil, err
	}
	annotateGenreMembershipRows(albums)
	shows, err := s.genreUpcomingShows(ctx, genreID, userID, 5)
	if err != nil {
		return nil, err
	}
	relatedGenres, err := s.relatedGenres(ctx, stringValue(summary["canonical_slug"]), relatedGenreLimit)
	if err != nil {
		return nil, err
	}
	summary["artist_count"] = len(artists)
	summary["album_count"] = len(albums)
	var trackTotal int64
	for _, album := range albums {
		trackTotal += intValue(album["track_count"])
	}
	summary["track_count"] = trackTotal
	summary["artists"] = artists
	summary["albums"] = albums
	summary["shows"] = shows
	summary["related_genres"] = relatedGenres
	return summary, nil
}

type genreShowLocation struct {
	latitude  float64
	longitude float64
	radiusKm  int64
}

func (s *Store) genreUpcomingShows(ctx context.Context, genreID int64, userID int64, limit int) ([]map[string]any, error) {
	if limit <= 0 {
		return []map[string]any{}, nil
	}
	location, ok, err := s.genreShowLocation(ctx, userID)
	if err != nil || !ok {
		return []map[string]any{}, err
	}
	delta := float64(location.radiusKm) / 111.0
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(queryCtx, `
		WITH target_genres AS (
			SELECT $1::BIGINT AS id
		),
		artist_memberships AS (
			SELECT
				ag.artist_name,
				ag.genre_id,
				ag.weight::DOUBLE PRECISION AS membership_score
			FROM artist_genres ag
			WHERE ag.genre_id IN (SELECT id FROM target_genres)
		),
		genre_artists AS (
			SELECT artist_name, membership_score
			FROM artist_memberships
			WHERE membership_score >= $2
		),
		candidate_shows AS (
			SELECT
				s.*,
				la.id AS artist_id,
				la.slug AS artist_slug,
				CASE WHEN s.latitude IS NOT NULL AND s.longitude IS NOT NULL THEN
					6371 * acos(
						LEAST(1.0, GREATEST(-1.0,
							cos(radians($3)) * cos(radians(s.latitude))
							* cos(radians(s.longitude) - radians($4))
							+ sin(radians($3)) * sin(radians(s.latitude))
						))
					)
				ELSE NULL END AS distance_km,
				ROW_NUMBER() OVER (
					PARTITION BY s.artist_name
					ORDER BY s.date ASC, s.local_time ASC NULLS LAST, s.id ASC
				) AS artist_show_rank,
				ARRAY(
					SELECT g2.name
					FROM artist_genres ag2
					JOIN genres g2 ON g2.id = ag2.genre_id
					WHERE ag2.artist_name = s.artist_name
					ORDER BY ag2.weight DESC, g2.name ASC
					LIMIT 3
				) AS artist_genres
			FROM shows s
			JOIN genre_artists pa ON pa.artist_name = s.artist_name
			LEFT JOIN library_artists la ON la.name = s.artist_name
			WHERE s.date >= CURRENT_DATE
			  AND COALESCE(s.status, '') != 'cancelled'
			  AND s.latitude IS NOT NULL
			  AND s.longitude IS NOT NULL
			  AND s.latitude BETWEEN $5 AND $6
			  AND s.longitude BETWEEN $7 AND $8
		)
		SELECT
			id,
			artist_name,
			artist_id,
			artist_slug,
			date::TEXT AS date,
			local_time::TEXT AS local_time,
			venue,
			address_line1,
			city,
			region,
			postal_code,
			country,
			country_code,
			latitude,
			longitude,
			url,
			image_url,
			lineup,
			status,
			source,
			lastfm_attendance,
			lastfm_url,
			tickets_url,
			artist_genres,
			distance_km
		FROM candidate_shows
		WHERE artist_show_rank = 1
		  AND distance_km <= $9
		ORDER BY date ASC, local_time ASC NULLS LAST, id ASC
		LIMIT $10
	`, genreID, minGenreMembershipScore, location.latitude, location.longitude, location.latitude-delta, location.latitude+delta, location.longitude-delta*1.5, location.longitude+delta*1.5, location.radiusKm, limit))
	if err != nil {
		return nil, err
	}
	shows := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		shows = append(shows, genreShowPayload(row))
	}
	return shows, nil
}

func (s *Store) genreShowLocation(ctx context.Context, userID int64) (genreShowLocation, bool, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(queryCtx, `
		SELECT
			latitude::DOUBLE PRECISION AS latitude,
			longitude::DOUBLE PRECISION AS longitude,
			COALESCE(show_radius_km, 60)::INTEGER AS show_radius_km,
			COALESCE(show_location_mode, 'fixed') AS show_location_mode
		FROM users
		WHERE id = $1
		LIMIT 1
	`, userID))
	if err != nil {
		return genreShowLocation{}, false, err
	}
	if len(rows) == 0 {
		return genreShowLocation{}, false, nil
	}
	row := rows[0]
	if row["latitude"] == nil || row["longitude"] == nil {
		return genreShowLocation{}, false, nil
	}
	if strings.EqualFold(strings.TrimSpace(stringValue(row["show_location_mode"])), "near_me") {
		return genreShowLocation{}, false, nil
	}
	radiusKm := intValue(row["show_radius_km"])
	if radiusKm <= 0 {
		radiusKm = 60
	}
	return genreShowLocation{
		latitude:  floatValue(row["latitude"]),
		longitude: floatValue(row["longitude"]),
		radiusKm:  radiusKm,
	}, true, nil
}

func genreShowPayload(row map[string]any) map[string]any {
	city := stringValue(row["city"])
	country := stringValue(row["country"])
	return map[string]any{
		"id":                row["id"],
		"type":              "show",
		"date":              stringValue(row["date"]),
		"time":              row["local_time"],
		"artist":            stringValue(row["artist_name"]),
		"artist_id":         row["artist_id"],
		"artist_slug":       row["artist_slug"],
		"title":             stringValue(row["venue"]),
		"subtitle":          strings.Join(nonEmptyStrings(city, country), ", "),
		"cover_url":         row["image_url"],
		"status":            firstNonEmpty(stringValue(row["status"]), "onsale"),
		"is_upcoming":       true,
		"url":               firstNonEmpty(stringValue(row["tickets_url"]), stringValue(row["url"]), stringValue(row["lastfm_url"])),
		"venue":             row["venue"],
		"address_line1":     row["address_line1"],
		"city":              row["city"],
		"region":            row["region"],
		"postal_code":       row["postal_code"],
		"country":           row["country"],
		"country_code":      row["country_code"],
		"latitude":          row["latitude"],
		"longitude":         row["longitude"],
		"lineup":            row["lineup"],
		"genres":            genreShowGenres(row["artist_genres"]),
		"source":            row["source"],
		"lastfm_attendance": row["lastfm_attendance"],
		"lastfm_url":        row["lastfm_url"],
		"tickets_url":       row["tickets_url"],
		"distance_km":       row["distance_km"],
	}
}

func genreShowGenres(value any) []string {
	switch typed := value.(type) {
	case []string:
		if len(typed) > 3 {
			return typed[:3]
		}
		return typed
	case []any:
		items := anyStrings(typed)
		if len(items) > 3 {
			return items[:3]
		}
		return items
	default:
		return []string{}
	}
}

func nonEmptyStrings(values ...string) []string {
	items := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			items = append(items, value)
		}
	}
	return items
}

var genreSummarySQL = `
		WITH target_genre AS (
			SELECT
				g.id,
				g.entity_uid,
				g.name,
				g.slug,
				tn.slug AS canonical_slug,
				tn.name AS canonical_name,
				tn.description AS canonical_description,
				tn.external_description,
				tn.external_description_source,
				tn.cover_path AS canonical_cover_path,
				tn.musicbrainz_mbid,
				tn.wikidata_entity_id,
				tn.wikidata_url,
				tn.eq_gains AS canonical_eq_gains,
				tn.eq_reasoning
			FROM genres g
			LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
			LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
			WHERE g.slug = $1
		),
		artist_counts AS (
			SELECT
				ag.genre_id,
				COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count
			FROM artist_genres ag
			JOIN target_genre tg ON tg.id = ag.genre_id
			GROUP BY ag.genre_id
		),
		album_counts AS (
			SELECT
				alg.genre_id,
				COUNT(DISTINCT alg.album_id)::INTEGER AS album_count
			FROM album_genres alg
			JOIN target_genre tg ON tg.id = alg.genre_id
			GROUP BY alg.genre_id
		)
		SELECT
			g.id,
			g.entity_uid::text AS entity_uid,
			g.name,
			g.slug,
			COALESCE(ac.artist_count, 0) AS artist_count,
			COALESCE(alc.album_count, 0) AS album_count,
			g.canonical_slug,
			g.canonical_name,
			g.canonical_description,
			g.external_description,
			g.external_description_source,
			g.canonical_cover_path,
			g.musicbrainz_mbid,
			g.wikidata_entity_id,
			g.wikidata_url,
			g.canonical_eq_gains,
			g.eq_reasoning,
			tl.slug AS top_level_slug,
			tl.name AS top_level_name,
			tl.description AS top_level_description,
			preset.gains AS preset_gains,
			preset.source AS preset_source,
			preset.slug AS preset_slug,
			preset.name AS preset_name
		FROM target_genre g
		LEFT JOIN artist_counts ac ON ac.genre_id = g.id
		LEFT JOIN album_counts alc ON alc.genre_id = g.id
		LEFT JOIN LATERAL (` + genreTopLevelSQL("g.canonical_slug") + `) tl ON g.canonical_slug IS NOT NULL
		LEFT JOIN LATERAL (` + genrePresetSQL("g.canonical_slug") + `) preset ON g.canonical_slug IS NOT NULL
	`

func (s *Store) genreSummaryBySlug(ctx context.Context, slug string) (map[string]any, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(queryCtx, genreSummarySQL, slug))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	row := rows[0]
	annotateGenreSummary(row, true)
	return row, nil
}

func (s *Store) hasLegacyStreamIDColumn(ctx context.Context) (bool, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(queryCtx, `
		SELECT 1
		FROM information_schema.columns
		WHERE table_name = 'library_tracks'
		  AND column_name = 'navidrome_id'
		LIMIT 1
	`))
	if err != nil {
		return false, err
	}
	return len(rows) > 0, nil
}

func playHistorySQL(hasLegacyStreamIDColumn bool) string {
	legacyMatch := ""
	if hasLegacyStreamIDColumn {
		legacyMatch = `
				UNION ALL
				SELECT matched.id, 3
				FROM library_tracks matched
				WHERE upe.track_id IS NULL
				  AND COALESCE(upe.track_path, '') <> ''
				  AND matched.navidrome_id = upe.track_path
		`
	}

	return `
		WITH recent_events AS MATERIALIZED (
			SELECT *
			FROM user_play_events
			WHERE user_id = $1
			ORDER BY ended_at DESC
			LIMIT $2
		)
		SELECT
			COALESCE(lt.id, upe.track_id) AS track_id,
			COALESCE(upe.global_track_uid::text, gct.global_track_uid::text) AS global_track_uid,
			COALESCE(gct.global_artist_uid::text, gca.global_artist_uid::text) AS global_artist_uid,
			gct.global_album_uid::text AS global_album_uid,
			lt.entity_uid::text AS track_entity_uid,
			COALESCE(lt.path, upe.track_path) AS track_path,
			COALESCE(lt.title, gct.canonical_title, upe.title) AS title,
			COALESCE(
				ar_by_album.name,
				ar_by_albumartist.name,
				ar_by_track.name,
				ar_by_event.name,
				gca.artist_name,
				gcartist.canonical_name,
				gct.artist_name,
				lt.albumartist,
				alb.artist,
				lt.artist,
				upe.artist
			) AS artist,
			COALESCE(ar_by_album.id, ar_by_albumartist.id, ar_by_track.id, ar_by_event.id) AS artist_id,
			COALESCE(
				ar_by_album.entity_uid::text,
				ar_by_albumartist.entity_uid::text,
				ar_by_track.entity_uid::text,
				ar_by_event.entity_uid::text
			) AS artist_entity_uid,
			COALESCE(ar_by_album.slug, ar_by_albumartist.slug, ar_by_track.slug, ar_by_event.slug) AS artist_slug,
			COALESCE(alb.name, lt.album, gca.canonical_name, gct.album_name, upe.album) AS album,
			alb.id AS album_id,
			alb.entity_uid::text AS album_entity_uid,
			alb.slug AS album_slug,
			upe.ended_at AS played_at
		FROM recent_events upe
		LEFT JOIN LATERAL (
			SELECT candidate.*
			FROM (
				SELECT matched.id AS track_id, 1 AS match_priority
				FROM library_tracks matched
				WHERE matched.id = upe.track_id
				UNION ALL
				SELECT matched.id, 2
				FROM library_tracks matched
				WHERE upe.track_id IS NULL
				  AND upe.track_entity_uid IS NOT NULL
				  AND matched.entity_uid = upe.track_entity_uid
				` + legacyMatch + `
				UNION ALL
				SELECT matched.id, 4
				FROM library_tracks matched
				WHERE upe.track_id IS NULL
				  AND COALESCE(upe.track_path, '') <> ''
				  AND matched.path = upe.track_path
			) matches
			JOIN library_tracks candidate ON candidate.id = matches.track_id
			ORDER BY matches.match_priority
			LIMIT 1
		) lt ON TRUE
		LEFT JOIN LATERAL (
			SELECT candidate.*
			FROM (
				SELECT matched.global_track_uid, 1 AS match_priority
				FROM global_catalog_tracks matched
				WHERE matched.global_track_uid = upe.global_track_uid
				UNION ALL
				SELECT matched.global_track_uid, 2
				FROM global_catalog_tracks matched
				WHERE upe.global_track_uid IS NULL
				  AND lt.entity_uid IS NOT NULL
				  AND matched.local_track_entity_uid = lt.entity_uid
				UNION ALL
				SELECT matched.global_track_uid, 3
				FROM global_catalog_tracks matched
				WHERE upe.global_track_uid IS NULL
				  AND lt.id IS NULL
				  AND COALESCE(NULLIF(TRIM(upe.artist), ''), '') <> ''
				  AND COALESCE(NULLIF(TRIM(upe.title), ''), '') <> ''
				  AND LOWER(matched.artist_name) = LOWER(upe.artist)
				  AND LOWER(matched.canonical_title) = LOWER(upe.title)
				  AND (
					COALESCE(NULLIF(TRIM(upe.album), ''), '') = ''
					OR LOWER(COALESCE(matched.album_name, '')) = LOWER(upe.album)
				  )
			) matches
			JOIN global_catalog_tracks candidate
			  ON candidate.global_track_uid = matches.global_track_uid
			ORDER BY
				matches.match_priority,
				candidate.has_local DESC,
				candidate.has_remote DESC,
				candidate.source_count DESC,
				candidate.global_track_uid
			LIMIT 1
		) gct ON TRUE
		LEFT JOIN global_catalog_albums gca
		  ON gca.global_album_uid = gct.global_album_uid
		LEFT JOIN global_catalog_artists gcartist
		  ON gcartist.global_artist_uid = gct.global_artist_uid
		LEFT JOIN library_albums alb ON alb.id = lt.album_id
		LEFT JOIN library_artists ar_by_album
		  ON COALESCE(alb.artist, '') <> ''
		 AND LOWER(ar_by_album.name) = LOWER(alb.artist)
		LEFT JOIN library_artists ar_by_albumartist
		  ON COALESCE(lt.albumartist, '') <> ''
		 AND LOWER(ar_by_albumartist.name) = LOWER(lt.albumartist)
		LEFT JOIN library_artists ar_by_track
		  ON COALESCE(lt.artist, '') <> ''
		 AND LOWER(ar_by_track.name) = LOWER(lt.artist)
		LEFT JOIN library_artists ar_by_event
		  ON COALESCE(upe.artist, '') <> ''
		 AND LOWER(ar_by_event.name) = LOWER(upe.artist)
		ORDER BY upe.ended_at DESC
	`
}

func (s *Store) playHistoryRows(ctx context.Context, userID int64, limit int, hasLegacyStreamIDColumn bool) ([]map[string]any, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	return rowsToMaps(s.pool.Query(queryCtx, playHistorySQL(hasLegacyStreamIDColumn), userID, limit))
}

func (s *Store) resolvePlayHistoryAlbumFallback(ctx context.Context, refs []historyFallbackRef) (map[string]map[string]any, error) {
	unique := []historyFallbackRef{}
	seen := map[string]struct{}{}
	for _, ref := range refs {
		key := historyFallbackKey(ref.artist, ref.title)
		if key == "\x00" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		unique = append(unique, ref)
	}
	out := map[string]map[string]any{}
	if len(unique) == 0 {
		return out, nil
	}

	values := make([]string, 0, len(unique))
	args := make([]any, 0, len(unique)*2)
	for index, ref := range unique {
		values = append(values, fmt.Sprintf("($%d, $%d)", index*2+1, index*2+2))
		args = append(args, strings.TrimSpace(strings.ToLower(ref.artist)), strings.TrimSpace(strings.ToLower(ref.title)))
	}

	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(queryCtx, `
		WITH input_pairs(artist, title) AS (
			VALUES `+strings.Join(values, ", ")+`
		)
		SELECT DISTINCT ON (LOWER(lt.artist), LOWER(lt.title))
			lt.id AS track_id,
			lt.entity_uid::text AS track_entity_uid,
			lt.path,
			lt.title,
			COALESCE(ar_by_album.name, ar_by_albumartist.name, ar_by_track.name, lt.albumartist, alb.artist, lt.artist) AS artist,
			alb.id AS album_id,
			alb.entity_uid::text AS album_entity_uid,
			alb.slug AS album_slug,
			alb.name AS album,
			COALESCE(ar_by_album.id, ar_by_albumartist.id, ar_by_track.id) AS artist_id,
			COALESCE(
				ar_by_album.entity_uid::text,
				ar_by_albumartist.entity_uid::text,
				ar_by_track.entity_uid::text
			) AS artist_entity_uid,
			COALESCE(ar_by_album.slug, ar_by_albumartist.slug, ar_by_track.slug) AS artist_slug
		FROM library_tracks lt
		LEFT JOIN library_albums alb ON alb.id = lt.album_id
		LEFT JOIN library_artists ar_by_album
		  ON COALESCE(alb.artist, '') <> ''
		 AND LOWER(ar_by_album.name) = LOWER(alb.artist)
		LEFT JOIN library_artists ar_by_albumartist
		  ON COALESCE(lt.albumartist, '') <> ''
		 AND LOWER(ar_by_albumartist.name) = LOWER(lt.albumartist)
		LEFT JOIN library_artists ar_by_track
		  ON COALESCE(lt.artist, '') <> ''
		 AND LOWER(ar_by_track.name) = LOWER(lt.artist)
		JOIN input_pairs ip
		  ON LOWER(lt.artist) = ip.artist
		 AND LOWER(lt.title) = ip.title
		ORDER BY
			LOWER(lt.artist),
			LOWER(lt.title),
			CASE WHEN alb.id IS NULL THEN 1 ELSE 0 END,
			lt.id DESC
	`, args...))
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		out[historyFallbackKey(stringValue(row["artist"]), stringValue(row["title"]))] = row
	}
	return out, nil
}
func (s *Store) variantSummaries(ctx context.Context, trackIDs []int64) (map[int64][]map[string]any, error) {
	out := map[int64][]map[string]any{}
	if len(trackIDs) == 0 {
		return out, nil
	}
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT
			sv.id, sv.track_id, sv.preset, sv.status, sv.delivery_format,
			sv.delivery_codec, sv.delivery_bitrate, sv.delivery_sample_rate,
			sv.bytes, sv.error, sv.task_id, sv.updated_at, sv.completed_at,
			t.status AS task_status
		FROM stream_variants sv
		JOIN library_tracks lt
		  ON lt.id = sv.track_id
		 AND lt.path = sv.source_path
		 AND COALESCE(lt.size, 0) = sv.source_size
		LEFT JOIN tasks t ON t.id = sv.task_id
		WHERE sv.track_id = ANY($1)
		ORDER BY sv.track_id, sv.preset, sv.updated_at DESC
	`, trackIDs))
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		id := intValue(row["track_id"])
		out[id] = append(out[id], row)
	}
	return out, nil
}

func (s *Store) lyricsStatus(ctx context.Context, albumID int64) (map[int64]map[string]any, error) {
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT DISTINCT ON (lt.id)
			lt.id AS track_id, tl.provider, tl.found,
			(tl.plain_lyrics IS NOT NULL AND length(tl.plain_lyrics) > 0) AS has_plain,
			(tl.synced_lyrics IS NOT NULL AND length(tl.synced_lyrics) > 0) AS has_synced,
			tl.updated_at
		FROM library_tracks lt
		LEFT JOIN track_lyrics tl ON tl.track_id = lt.id OR tl.track_entity_uid = lt.entity_uid
		WHERE lt.album_id = $1
		ORDER BY lt.id, tl.updated_at DESC NULLS LAST
	`, albumID))
	if err != nil {
		return nil, err
	}
	out := map[int64]map[string]any{}
	for _, row := range rows {
		if row["provider"] == nil {
			continue
		}
		found := boolValue(row["found"])
		hasPlain := boolValue(row["has_plain"])
		hasSynced := boolValue(row["has_synced"])
		status := "none"
		if found {
			status = "found"
		}
		if hasSynced {
			status = "synced"
		} else if hasPlain {
			status = "plain"
		}
		out[intValue(row["track_id"])] = map[string]any{
			"status":     status,
			"found":      found,
			"has_plain":  hasPlain,
			"has_synced": hasSynced,
			"provider":   firstNonEmpty(stringValue(row["provider"]), "lrclib"),
			"updated_at": row["updated_at"],
		}
	}
	return out, nil
}
