package catalog

import (
	"context"
	"strings"

	"github.com/thecrateapp/crate/app/readplane/internal/postgres"
)
func (s *Store) TrackInfoByID(ctx context.Context, trackID int64) (map[string]any, error) {
	row, err := s.trackInfoRow(ctx, "id = $1", trackID)
	if err != nil {
		return nil, err
	}
	return serializeTrackInfo(row), nil
}

func (s *Store) TrackInfoByEntityUID(ctx context.Context, entityUID string) (map[string]any, error) {
	row, err := s.trackInfoRow(ctx, "entity_uid = $1::uuid", entityUID)
	if err != nil {
		return nil, err
	}
	return serializeTrackInfo(row), nil
}

func (s *Store) TrackEQFeaturesByID(ctx context.Context, trackID int64) (map[string]any, error) {
	row, err := s.eqFeaturesRow(ctx, "id = $1", trackID)
	if err != nil {
		return nil, err
	}
	return serializeEQFeatures(row), nil
}

func (s *Store) TrackEQFeaturesByEntityUID(ctx context.Context, entityUID string) (map[string]any, error) {
	row, err := s.eqFeaturesRow(ctx, "entity_uid = $1::uuid", entityUID)
	if err != nil {
		return nil, err
	}
	return serializeEQFeatures(row), nil
}

func (s *Store) TrackGenreByID(ctx context.Context, trackID int64) (map[string]any, error) {
	return s.trackGenrePayload(ctx, "t.id = $1", trackID)
}

func (s *Store) TrackGenreByEntityUID(ctx context.Context, entityUID string) (map[string]any, error) {
	return s.trackGenrePayload(ctx, "t.entity_uid = $1::uuid", entityUID)
}

func (s *Store) TrackPlaybackByID(ctx context.Context, trackID int64) (map[string]any, error) {
	row, err := s.playbackTrackRow(ctx, "id = $1", trackID)
	if err != nil {
		return nil, err
	}
	return playbackPayload(row, "original"), nil
}

func (s *Store) TrackPlaybackByEntityUID(ctx context.Context, entityUID string) (map[string]any, error) {
	row, err := s.playbackTrackRow(ctx, "entity_uid = $1::uuid", entityUID)
	if err != nil {
		return nil, err
	}
	return playbackPayload(row, "original"), nil
}
func (s *Store) trackInfoRow(ctx context.Context, predicate string, args ...any) (map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT entity_uid::text AS entity_uid, storage_id::text AS storage_id, title, artist, album,
		       format, bitrate, sample_rate, bit_depth, bpm, audio_key, audio_scale,
		       energy, danceability, valence, acousticness, instrumentalness, loudness,
		       dynamic_range, mood_json, lastfm_listeners, lastfm_playcount,
		       popularity, rating, bliss_vector, path
		FROM library_tracks
		WHERE `+predicate+`
		LIMIT 1
	`, args...))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return rows[0], nil
}

func (s *Store) eqFeaturesRow(ctx context.Context, predicate string, args ...any) (map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT energy, loudness, dynamic_range, spectral_complexity,
		       danceability, valence, acousticness, instrumentalness
		FROM library_tracks
		WHERE `+predicate+`
		LIMIT 1
	`, args...))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return rows[0], nil
}

func (s *Store) playbackTrackRow(ctx context.Context, predicate string, args ...any) (map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT id, entity_uid::text AS entity_uid, path, title, artist, album,
		       format, bitrate, sample_rate, bit_depth, duration, size
		FROM library_tracks
		WHERE `+predicate+`
		LIMIT 1
	`, args...))
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return rows[0], nil
}

func (s *Store) trackGenrePayload(ctx context.Context, predicate string, args ...any) (map[string]any, error) {
	trackID, err := s.trackID(ctx, predicate, args...)
	if err != nil {
		return nil, err
	}
	albumRows, err := s.trackAlbumGenreRows(ctx, trackID)
	if err != nil {
		return nil, err
	}
	artistRows, err := s.trackArtistGenreRows(ctx, trackID)
	if err != nil {
		return nil, err
	}

	if picked, err := s.pickTrackGenre(ctx, albumRows, true); err != nil {
		return nil, err
	} else if picked != nil {
		picked["source"] = "album"
		return picked, nil
	}
	if picked, err := s.pickTrackGenre(ctx, artistRows, true); err != nil {
		return nil, err
	} else if picked != nil {
		picked["source"] = "artist"
		return picked, nil
	}
	if picked, err := s.pickTrackGenre(ctx, albumRows, false); err != nil {
		return nil, err
	} else if picked != nil {
		picked["source"] = "album"
		return picked, nil
	}
	if picked, err := s.pickTrackGenre(ctx, artistRows, false); err != nil {
		return nil, err
	} else if picked != nil {
		picked["source"] = "artist"
		return picked, nil
	}
	return emptyTrackGenrePayload(), nil
}

func (s *Store) trackID(ctx context.Context, predicate string, args ...any) (int64, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(queryCtx, `
		SELECT t.id
		FROM library_tracks t
		WHERE `+predicate+`
		LIMIT 1
	`, args...))
	if err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, ErrNotFound
	}
	return intValue(rows[0]["id"]), nil
}

func (s *Store) trackAlbumGenreRows(ctx context.Context, trackID int64) ([]map[string]any, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	return rowsToMaps(s.pool.Query(queryCtx, `
		SELECT g.name, g.slug, ag.weight, tn.slug AS canonical_slug, tn.name AS canonical_name
		FROM library_tracks t
		JOIN album_genres ag ON ag.album_id = t.album_id
		JOIN genres g ON g.id = ag.genre_id
		LEFT JOIN genre_taxonomy_aliases gta
		  ON gta.alias_slug = g.slug OR lower(trim(gta.alias_name)) = lower(trim(g.name))
		LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
		WHERE t.id = $1
		ORDER BY ag.weight DESC NULLS LAST, g.name ASC
		LIMIT 10
	`, trackID))
}

func (s *Store) trackArtistGenreRows(ctx context.Context, trackID int64) ([]map[string]any, error) {
	queryCtx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	return rowsToMaps(s.pool.Query(queryCtx, `
		SELECT g.name, g.slug, MAX(arg.weight) AS weight, tn.slug AS canonical_slug, tn.name AS canonical_name
		FROM library_tracks t
		LEFT JOIN library_albums a ON a.id = t.album_id
		JOIN artist_genres arg ON arg.artist_name IN (t.artist, a.artist)
		JOIN genres g ON g.id = arg.genre_id
		LEFT JOIN genre_taxonomy_aliases gta
		  ON gta.alias_slug = g.slug OR lower(trim(gta.alias_name)) = lower(trim(g.name))
		LEFT JOIN genre_taxonomy_nodes tn ON tn.id = gta.genre_id
		WHERE t.id = $1
		GROUP BY g.name, g.slug, tn.slug, tn.name
		ORDER BY MAX(arg.weight) DESC NULLS LAST, g.name ASC
		LIMIT 10
	`, trackID))
}

func (s *Store) pickTrackGenre(ctx context.Context, rows []map[string]any, canonicalOnly bool) (map[string]any, error) {
	for _, row := range rows {
		canonicalSlug := strings.TrimSpace(stringValue(row["canonical_slug"]))
		if canonicalSlug != "" {
			topLevel, preset, err := s.genreTaxonomyContext(ctx, canonicalSlug)
			if err != nil {
				return nil, err
			}
			return map[string]any{
				"primary": map[string]any{
					"slug":      canonicalSlug,
					"name":      firstNonEmpty(stringValue(row["canonical_name"]), canonicalSlug),
					"canonical": true,
				},
				"topLevel": topLevel,
				"preset":   preset,
			}, nil
		}
		if canonicalOnly {
			continue
		}
		rawSlug := strings.TrimSpace(strings.ToLower(stringValue(row["slug"])))
		rawName := strings.TrimSpace(strings.ToLower(stringValue(row["name"])))
		if rawSlug == "" && rawName == "" {
			continue
		}
		if rawName == "" {
			rawName = strings.ReplaceAll(rawSlug, "-", " ")
		}
		return map[string]any{
			"primary": map[string]any{
				"slug":      rawSlug,
				"name":      rawName,
				"canonical": false,
			},
			"topLevel": nil,
			"preset":   nil,
		}, nil
	}
	return nil, nil
}
