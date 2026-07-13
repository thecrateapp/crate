package catalog

import (
	"context"
	"strings"

	"golang.org/x/sync/errgroup"

	"github.com/thecrateapp/crate/app/readplane/internal/postgres"
)

// GlobalSearch reads the canonical node-first catalog. It deliberately never
// falls back to library_* tables: a zero-peer node is represented by its local
// sources in global_catalog_*.
func (s *Store) GlobalSearch(ctx context.Context, query string, limit int) (map[string]any, error) {
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
	group, groupCtx := errgroup.WithContext(ctx)

	group.Go(func() error {
		var err error
		artists, err = rowsToMaps(s.pool.Query(groupCtx, `
			SELECT global_artist_uid::text AS global_uid,
			       global_artist_uid::text AS global_artist_uid,
			       local_artist_id AS id,
			       local_artist_entity_uid::text AS entity_uid,
			       canonical_name AS name, has_photo
			FROM global_catalog_artists
			WHERE canonical_name ILIKE $1 AND (has_local OR has_remote)
			ORDER BY has_local DESC, source_count DESC, canonical_name ASC
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

	group.Go(func() error {
		var err error
		albums, err = rowsToMaps(s.pool.Query(groupCtx, `
			SELECT global_album_uid::text AS global_uid,
			       global_album_uid::text AS global_album_uid,
			       global_artist_uid::text AS global_artist_uid,
			       local_album_id AS id,
			       local_album_entity_uid::text AS entity_uid,
			       artist_name AS artist, canonical_name AS name, year, has_cover
			FROM global_catalog_albums
			WHERE (canonical_name ILIKE $1 OR artist_name ILIKE $1)
			  AND (has_local OR has_remote)
			ORDER BY has_local DESC, source_count DESC, artist_name ASC, canonical_name ASC
			LIMIT $2
		`, like, cappedLimit))
		if err != nil {
			return err
		}
		for _, album := range albums {
			album["has_cover"] = boolValue(album["has_cover"])
			if album["year"] == nil {
				album["year"] = ""
			}
		}
		return nil
	})

	group.Go(func() error {
		var err error
		tracks, err = rowsToMaps(s.pool.Query(groupCtx, `
			SELECT global_track_uid::text AS global_uid,
			       global_track_uid::text AS global_track_uid,
			       global_artist_uid::text AS global_artist_uid,
			       global_album_uid::text AS global_album_uid,
			       local_track_id AS id,
			       local_track_entity_uid::text AS entity_uid,
			       canonical_title AS title, artist_name AS artist,
			       album_name AS album, duration_seconds AS duration
			FROM global_catalog_tracks
			WHERE (canonical_title ILIKE $1 OR artist_name ILIKE $1 OR album_name ILIKE $1)
			  AND (has_local OR has_remote)
			ORDER BY has_local DESC, source_count DESC, artist_name ASC, canonical_title ASC
			LIMIT $2
		`, like, cappedLimit))
		if err != nil {
			return err
		}
		for _, track := range tracks {
			track["path"] = nil
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

	if err := group.Wait(); err != nil {
		return nil, err
	}
	return map[string]any{"artists": artists, "albums": albums, "tracks": tracks}, nil
}
