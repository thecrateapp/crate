package catalog

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/sync/errgroup"

	"github.com/thecrateapp/crate/app/readplane/internal/postgres"
)

var ErrNotFound = errors.New("catalog item not found")

// Store provides read-only catalog queries backed by a PostgreSQL pool.
type Store struct {
	pool         *pgxpool.Pool
	queryTimeout time.Duration
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
	q := strings.TrimSpace(query)
	cappedLimit := clamp(limit, 1, 50)
	if len(q) < 2 {
		return map[string]any{"artists": []any{}, "albums": []any{}, "tracks": []any{}}, nil
	}
	like := "%" + q + "%"
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()

	var artists []map[string]any
	var albums []map[string]any
	var tracks []map[string]any

	g, gCtx := errgroup.WithContext(ctx)

	g.Go(func() error {
		var err error
		artists, err = rowsToMaps(s.pool.Query(gCtx, `
			SELECT id, entity_uid::text AS entity_uid, slug, name, album_count, has_photo
			FROM library_artists
			WHERE name ILIKE $1
			ORDER BY listeners DESC NULLS LAST, album_count DESC, name ASC
			LIMIT $2
		`, like, cappedLimit))
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
		albums, err = rowsToMaps(s.pool.Query(gCtx, `
			SELECT a.id, a.entity_uid::text AS entity_uid, a.slug, a.artist, a.name, a.year, a.has_cover,
			       ar.id AS artist_id, ar.entity_uid::text AS artist_entity_uid, ar.slug AS artist_slug
			FROM library_albums a
			LEFT JOIN library_artists ar ON ar.name = a.artist
			WHERE a.name ILIKE $1 OR a.artist ILIKE $1
			ORDER BY year DESC NULLS LAST, name ASC
			LIMIT $2
		`, like, cappedLimit))
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
		tracks, err = rowsToMaps(s.pool.Query(gCtx, `
			SELECT t.id, t.entity_uid::text AS entity_uid, t.slug, t.title, t.artist,
			       ar.id AS artist_id, ar.entity_uid::text AS artist_entity_uid, ar.slug AS artist_slug,
			       a.id AS album_id, a.entity_uid::text AS album_entity_uid, a.slug AS album_slug,
			       a.name AS album, t.path, t.duration
			FROM library_tracks t
			JOIN library_albums a ON t.album_id = a.id
			LEFT JOIN library_artists ar ON ar.name = t.artist
			WHERE t.title ILIKE $1 OR t.artist ILIKE $1 OR a.name ILIKE $1
			ORDER BY t.title ASC
			LIMIT $2
		`, like, cappedLimit))
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
	return rowsToMaps(s.pool.Query(ctx, `
		SELECT
			uf.artist_name,
			uf.created_at,
			la.id AS artist_id,
			la.entity_uid::text AS artist_entity_uid,
			la.slug AS artist_slug,
			la.album_count,
			la.track_count,
			la.has_photo
		FROM user_follows uf
		LEFT JOIN library_artists la ON la.name = uf.artist_name
		WHERE uf.user_id = $1
		ORDER BY uf.created_at DESC
	`, userID))
}

// SavedAlbums returns the albums saved by the given user.
func (s *Store) SavedAlbums(ctx context.Context, userID int64) ([]map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	return rowsToMaps(s.pool.Query(ctx, `
		SELECT
			usa.created_at AS saved_at,
			la.id,
			la.entity_uid::text AS album_entity_uid,
			la.slug,
			la.artist,
			art.id AS artist_id,
			art.entity_uid::text AS artist_entity_uid,
			art.slug AS artist_slug,
			la.name,
			la.year,
			la.has_cover,
			la.track_count,
			la.total_duration
		FROM user_saved_albums usa
		JOIN library_albums la ON la.id = usa.album_id
		LEFT JOIN library_artists art ON art.name = la.artist
		WHERE usa.user_id = $1
		ORDER BY usa.created_at DESC
	`, userID))
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
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT
			(SELECT COUNT(*) FROM user_follows WHERE user_id = $1)::INTEGER AS followed_artists,
			(SELECT COUNT(*) FROM user_saved_albums WHERE user_id = $1)::INTEGER AS saved_albums,
			(SELECT COUNT(*) FROM user_liked_tracks WHERE user_id = $1)::INTEGER AS liked_tracks,
			(SELECT COUNT(*) FROM playlists WHERE user_id = $1)::INTEGER AS playlists
	`, userID))
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
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT 1
		FROM user_follows
		WHERE user_id = $1 AND artist_name = $2
		LIMIT 1
	`, userID, artistName))
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
// Genres returns all genres with artist/album counts and taxonomy metadata.
func (s *Store) Genres(ctx context.Context) ([]map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT
			g.id,
			g.entity_uid::text AS entity_uid,
			g.name,
			g.slug,
			COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
			COUNT(DISTINCT alg.album_id)::INTEGER AS album_count,
			tn.slug AS canonical_slug,
			tn.name AS canonical_name,
			tn.description AS canonical_description,
			tn.external_description,
			tn.external_description_source,
			tn.musicbrainz_mbid,
			tn.wikidata_entity_id,
			tn.wikidata_url,
			tl.slug AS top_level_slug,
			tl.name AS top_level_name,
			tl.description AS top_level_description
		FROM genres g
		LEFT JOIN artist_genres ag ON g.id = ag.genre_id
		LEFT JOIN album_genres alg ON g.id = alg.genre_id
		LEFT JOIN genre_taxonomy_aliases gta
		  ON gta.alias_slug = g.slug OR lower(trim(gta.alias_name)) = lower(trim(g.name))
		LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
		LEFT JOIN LATERAL (`+genreTopLevelSQL("tn.slug")+`) tl ON tn.slug IS NOT NULL
		GROUP BY
			g.id,
			g.entity_uid,
			g.name,
			g.slug,
			tn.slug,
			tn.name,
			tn.description,
			tn.external_description,
			tn.external_description_source,
			tn.musicbrainz_mbid,
			tn.wikidata_entity_id,
			tn.wikidata_url,
			tl.slug,
			tl.name,
			tl.description
		HAVING COUNT(DISTINCT ag.artist_name) > 0 OR COUNT(DISTINCT alg.album_id) > 0
		ORDER BY COUNT(DISTINCT ag.artist_name) DESC
	`))
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		annotateGenreSummary(row, false)
	}
	return rows, nil
}

// GenreDetail returns a single genre summary with its artists and albums.
func (s *Store) GenreDetail(ctx context.Context, slug string) (map[string]any, error) {
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
			la.listeners
		FROM artist_genres ag
		JOIN library_artists la ON ag.artist_name = la.name
		WHERE ag.genre_id = $1
		ORDER BY ag.weight DESC, la.listeners DESC NULLS LAST
	`, genreID))
	if err != nil {
		return nil, err
	}
	albums, err := rowsToMaps(s.pool.Query(queryCtx, `
		SELECT DISTINCT ON (a.id)
			a.id AS album_id,
			a.slug AS album_slug,
			a.artist,
			ar.id AS artist_id,
			ar.slug AS artist_slug,
			a.name,
			a.year,
			a.track_count,
			a.has_cover,
			COALESCE(alg.weight, ag.weight, 0.5) AS weight
		FROM library_albums a
		LEFT JOIN library_artists ar ON ar.name = a.artist
		LEFT JOIN album_genres alg ON alg.album_id = a.id AND alg.genre_id = $1
		LEFT JOIN artist_genres ag ON ag.artist_name = a.artist AND ag.genre_id = $1
		WHERE alg.genre_id IS NOT NULL OR ag.genre_id IS NOT NULL
		ORDER BY a.id, a.year DESC NULLS LAST
	`, genreID))
	if err != nil {
		return nil, err
	}
	summary["artists"] = artists
	summary["albums"] = albums
	return summary, nil
}
func (s *Store) genreSummaryBySlug(ctx context.Context, slug string) (map[string]any, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(queryCtx, `
		SELECT
			g.id,
			g.entity_uid::text AS entity_uid,
			g.name,
			g.slug,
			COUNT(DISTINCT ag.artist_name)::INTEGER AS artist_count,
			COUNT(DISTINCT alg.album_id)::INTEGER AS album_count,
			tn.slug AS canonical_slug,
			tn.name AS canonical_name,
			tn.description AS canonical_description,
			tn.external_description,
			tn.external_description_source,
			tn.musicbrainz_mbid,
			tn.wikidata_entity_id,
			tn.wikidata_url,
			tn.eq_gains AS canonical_eq_gains,
			tn.eq_reasoning,
			tl.slug AS top_level_slug,
			tl.name AS top_level_name,
			tl.description AS top_level_description,
			preset.gains AS preset_gains,
			preset.source AS preset_source,
			preset.slug AS preset_slug,
			preset.name AS preset_name
		FROM genres g
		LEFT JOIN artist_genres ag ON g.id = ag.genre_id
		LEFT JOIN album_genres alg ON g.id = alg.genre_id
		LEFT JOIN genre_taxonomy_aliases gta ON gta.alias_slug = g.slug
		LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
		LEFT JOIN LATERAL (`+genreTopLevelSQL("tn.slug")+`) tl ON tn.slug IS NOT NULL
		LEFT JOIN LATERAL (`+genrePresetSQL("tn.slug")+`) preset ON tn.slug IS NOT NULL
		WHERE g.slug = $1
		GROUP BY
			g.id,
			g.entity_uid,
			g.name,
			g.slug,
			tn.slug,
			tn.name,
			tn.description,
			tn.external_description,
			tn.external_description_source,
			tn.musicbrainz_mbid,
			tn.wikidata_entity_id,
			tn.wikidata_url,
			tn.eq_gains,
			tn.eq_reasoning,
			tl.slug,
			tl.name,
			tl.description,
			preset.gains,
			preset.source,
			preset.slug,
			preset.name
	`, slug))
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

func (s *Store) playHistoryRows(ctx context.Context, userID int64, limit int, hasLegacyStreamIDColumn bool) ([]map[string]any, error) {
	joinPredicate := `
		ON lt.id = upe.track_id
		OR (upe.track_id IS NULL AND upe.track_entity_uid IS NOT NULL AND lt.entity_uid = upe.track_entity_uid)
		OR (upe.track_id IS NULL AND COALESCE(upe.track_path, '') <> '' AND lt.path = upe.track_path)
	`
	if hasLegacyStreamIDColumn {
		joinPredicate = `
			ON lt.id = upe.track_id
			OR (upe.track_id IS NULL AND upe.track_entity_uid IS NOT NULL AND lt.entity_uid = upe.track_entity_uid)
			OR (upe.track_id IS NULL AND COALESCE(upe.track_path, '') <> '' AND lt.navidrome_id = upe.track_path)
			OR (upe.track_id IS NULL AND COALESCE(upe.track_path, '') <> '' AND lt.path = upe.track_path)
		`
	}

	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	return rowsToMaps(s.pool.Query(queryCtx, `
		SELECT
			COALESCE(lt.id, upe.track_id) AS track_id,
			lt.entity_uid::text AS track_entity_uid,
			COALESCE(lt.path, upe.track_path) AS track_path,
			COALESCE(lt.title, upe.title) AS title,
			COALESCE(ar_by_album.name, ar_by_albumartist.name, ar_by_track.name, ar_by_event.name, lt.albumartist, alb.artist, lt.artist, upe.artist) AS artist,
			COALESCE(ar_by_album.id, ar_by_albumartist.id, ar_by_track.id, ar_by_event.id) AS artist_id,
			COALESCE(
				ar_by_album.entity_uid::text,
				ar_by_albumartist.entity_uid::text,
				ar_by_track.entity_uid::text,
				ar_by_event.entity_uid::text
			) AS artist_entity_uid,
			COALESCE(ar_by_album.slug, ar_by_albumartist.slug, ar_by_track.slug, ar_by_event.slug) AS artist_slug,
			COALESCE(lt.album, upe.album) AS album,
			alb.id AS album_id,
			alb.entity_uid::text AS album_entity_uid,
			alb.slug AS album_slug,
			upe.ended_at AS played_at
		FROM user_play_events upe
		LEFT JOIN library_tracks lt
		`+joinPredicate+`
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
		WHERE upe.user_id = $1
		ORDER BY upe.ended_at DESC
		LIMIT $2
	`, userID, limit))
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
