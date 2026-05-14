package catalog

import (
	"context"
	"errors"
	"math"
	"sort"
	"strings"

	"github.com/thecrateapp/crate/app/readplane/internal/postgres"
)
func (s *Store) ArtistByID(ctx context.Context, artistID int64) (map[string]any, error) {
	row, err := s.artistRow(ctx, "id = $1", artistID)
	if err != nil {
		return nil, err
	}
	return s.artistPayload(ctx, row)
}

func (s *Store) ArtistByEntityUID(ctx context.Context, entityUID string) (map[string]any, error) {
	row, err := s.artistRow(ctx, "entity_uid = $1::uuid", entityUID)
	if err != nil {
		return nil, err
	}
	return s.artistPayload(ctx, row)
}

func (s *Store) ArtistBySlug(ctx context.Context, slug string) (map[string]any, error) {
	row, err := s.artistRow(ctx, "slug = $1", slug)
	if err != nil {
		return nil, err
	}
	return s.artistPayload(ctx, row)
}

func (s *Store) ArtistTopTracksByID(ctx context.Context, artistID int64, count int) ([]map[string]any, error) {
	row, err := s.artistRow(ctx, "id = $1", artistID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return []map[string]any{}, nil
		}
		return nil, err
	}
	return s.artistTopTracks(ctx, stringValue(row["name"]), count)
}

func (s *Store) ArtistTopTracksByEntityUID(ctx context.Context, entityUID string, count int) ([]map[string]any, error) {
	row, err := s.artistRow(ctx, "entity_uid = $1::uuid", entityUID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return []map[string]any{}, nil
		}
		return nil, err
	}
	return s.artistTopTracks(ctx, stringValue(row["name"]), count)
}

func (s *Store) ArtistTopTracksBySlug(ctx context.Context, slug string, count int) ([]map[string]any, error) {
	row, err := s.artistRow(ctx, "slug = $1", slug)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return []map[string]any{}, nil
		}
		return nil, err
	}
	return s.artistTopTracks(ctx, stringValue(row["name"]), count)
}
func (s *Store) artistRow(ctx context.Context, predicate string, args ...any) (map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT id, entity_uid::text AS entity_uid, slug, name, folder_name, album_count,
		       track_count, total_size, formats_json, primary_format, has_photo, updated_at,
		       popularity, popularity_score, popularity_confidence
		FROM library_artists
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

func (s *Store) artistPayload(ctx context.Context, artist map[string]any) (map[string]any, error) {
	name := stringValue(artist["name"])
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	albums, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT a.id, a.entity_uid::text AS entity_uid, a.slug, a.name, a.track_count AS tracks,
		       a.formats_json AS formats, q.bit_depth, q.sample_rate, a.total_size,
		       a.year, a.has_cover, a.musicbrainz_albumid, a.popularity,
		       a.popularity_score, a.popularity_confidence
		FROM library_albums a
		LEFT JOIN (
			SELECT album_id, MAX(bit_depth) AS bit_depth, MAX(sample_rate) AS sample_rate
			FROM library_tracks
			WHERE format IS NOT NULL
			GROUP BY album_id
		) q ON q.album_id = a.id
		WHERE lower(a.artist) = lower($1) AND a.quarantined_at IS NULL
		ORDER BY a.year, a.name
	`, name))
	if err != nil {
		return nil, err
	}
	for _, album := range albums {
		album["display_name"] = displayName(stringValue(album["name"]))
		album["size_mb"] = int64(math.Round(float64(intValue(album["total_size"])) / (1024 * 1024)))
		delete(album, "total_size")
		album["has_cover"] = boolValue(album["has_cover"])
		if album["formats"] == nil {
			album["formats"] = []any{}
		}
	}
	genres, profile, err := s.artistGenres(ctx, name)
	if err != nil {
		return nil, err
	}
	issueCount, err := s.artistIssueCount(ctx, name)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id":                    artist["id"],
		"entity_uid":            artist["entity_uid"],
		"slug":                  artist["slug"],
		"name":                  name,
		"updated_at":            artist["updated_at"],
		"albums":                albums,
		"total_tracks":          intValue(artist["track_count"]),
		"total_size_mb":         int64(math.Round(float64(intValue(artist["total_size"])) / (1024 * 1024))),
		"primary_format":        artist["primary_format"],
		"genres":                genres,
		"genre_profile":         profile,
		"issue_count":           issueCount,
		"is_v2":                 looksLikeUUID(stringValue(artist["folder_name"])),
		"popularity":            artist["popularity"],
		"popularity_score":      artist["popularity_score"],
		"popularity_confidence": artist["popularity_confidence"],
	}, nil
}
func (s *Store) artistTopTracks(ctx context.Context, artistName string, count int) ([]map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT
			t.id, t.title, t.artist, t.album, t.path, t.duration,
			t.track_number, t.format, t.bpm, t.audio_key, t.audio_scale,
			t.energy, t.danceability, t.valence, t.bliss_vector,
			t.entity_uid::text AS track_entity_uid,
			a.id AS album_id, a.entity_uid::text AS album_entity_uid, a.slug AS album_slug, a.year,
			ar.id AS artist_id, ar.entity_uid::text AS artist_entity_uid, ar.slug AS artist_slug
		FROM library_tracks t
		LEFT JOIN library_albums a ON a.id = t.album_id
		LEFT JOIN library_artists ar ON ar.name = t.artist
		WHERE t.artist = $1
	`, artistName))
	if err != nil {
		return nil, err
	}
	seenTitles := map[string]map[string]any{}
	for _, row := range rows {
		key := strings.ToLower(stringValue(row["title"]))
		if _, ok := seenTitles[key]; !ok {
			seenTitles[key] = row
		}
	}
	remaining := make([]map[string]any, 0, len(seenTitles))
	for _, row := range seenTitles {
		remaining = append(remaining, row)
	}
	sort.Slice(remaining, func(i, j int) bool {
		yi := stringValue(remaining[i]["year"])
		yj := stringValue(remaining[j]["year"])
		if yi != yj {
			return yi > yj
		}
		return intValue(remaining[i]["track_number"]) > intValue(remaining[j]["track_number"])
	})
	limit := clamp(count, 1, 50)
	if len(remaining) > limit {
		remaining = remaining[:limit]
	}
	out := make([]map[string]any, 0, len(remaining))
	for _, row := range remaining {
		out = append(out, formatArtistTopTrack(row))
	}
	return out, nil
}
func (s *Store) artistGenres(ctx context.Context, artistName string) ([]any, []map[string]any, error) {
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT g.name, g.slug, ag.weight, ag.source
		FROM artist_genres ag
		JOIN genres g ON g.id = ag.genre_id
		WHERE ag.artist_name = $1
		ORDER BY ag.weight DESC NULLS LAST, g.name ASC
		LIMIT 8
	`, artistName))
	if err != nil {
		return nil, nil, err
	}
	genres := make([]any, 0, len(rows))
	for _, row := range rows {
		genres = append(genres, stringValue(row["name"]))
	}
	return genres, buildGenreProfile(rows, 8), nil
}

func (s *Store) artistIssueCount(ctx context.Context, artistName string) (int64, error) {
	var count int64
	err := s.pool.QueryRow(ctx, `
		SELECT COUNT(*) AS cnt FROM health_issues
		WHERE status = 'open'
		  AND (details_json->>'artist' = $1 OR details_json->>'db_artist' = $1)
	`, artistName).Scan(&count)
	return count, err
}
