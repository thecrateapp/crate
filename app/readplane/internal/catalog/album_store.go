package catalog

import (
	"context"
	"math"
	"strings"

	"github.com/thecrateapp/crate/app/readplane/internal/postgres"
)
func (s *Store) AlbumByID(ctx context.Context, albumID int64) (map[string]any, error) {
	row, err := s.albumRow(ctx, "a.id = $1", albumID)
	if err != nil {
		return nil, err
	}
	return s.albumPayload(ctx, row)
}

func (s *Store) AlbumByEntityUID(ctx context.Context, entityUID string) (map[string]any, error) {
	row, err := s.albumRow(ctx, "a.entity_uid = $1::uuid", entityUID)
	if err != nil {
		return nil, err
	}
	return s.albumPayload(ctx, row)
}

func (s *Store) AlbumByArtistAndAlbumSlug(ctx context.Context, artistSlug string, albumSlug string) (map[string]any, error) {
	rows, err := s.albumRows(ctx, "ar.slug = $1", artistSlug)
	if err != nil {
		return nil, err
	}
	target := slugify(albumSlug)
	for _, row := range rows {
		if stringValue(row["slug"]) == albumSlug ||
			publicAlbumSlug(stringValue(row["slug"]), artistSlug) == target ||
			publicAlbumSlug(stringValue(row["name"]), artistSlug) == target {
			return s.albumPayload(ctx, row)
		}
	}
	return nil, ErrNotFound
}
func (s *Store) albumRow(ctx context.Context, predicate string, args ...any) (map[string]any, error) {
	rows, err := s.albumRows(ctx, predicate, args...)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ErrNotFound
	}
	return rows[0], nil
}

func (s *Store) albumRows(ctx context.Context, predicate string, args ...any) ([]map[string]any, error) {
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()
	return rowsToMaps(s.pool.Query(ctx, `
		SELECT a.id, a.entity_uid::text AS entity_uid, a.slug, a.artist, a.name, a.path,
		       a.track_count, a.total_size, a.total_duration, a.formats_json, a.year, a.genre,
		       a.has_cover, a.musicbrainz_albumid, a.popularity, a.popularity_score,
		       a.popularity_confidence,
		       ar.id AS artist_id, ar.entity_uid::text AS artist_entity_uid, ar.slug AS artist_slug
		FROM library_albums a
		LEFT JOIN library_artists ar ON ar.name = a.artist
		WHERE `+predicate+`
	`, args...))
}

func (s *Store) albumPayload(ctx context.Context, album map[string]any) (map[string]any, error) {
	albumID := intValue(album["id"])
	ctx, cancel := postgres.WithTimeout(ctx, s.queryTimeout)
	defer cancel()

	tracks, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT id, entity_uid::text AS entity_uid, storage_id::text AS storage_id, filename,
		       format, size, bitrate, sample_rate, bit_depth, bpm, audio_key, audio_scale,
		       energy, danceability, valence, bliss_vector, duration, popularity,
		       popularity_score, popularity_confidence, rating, title, artist, album,
		       albumartist, track_number, disc_number, year, genre, musicbrainz_albumid,
		       musicbrainz_trackid, path
		FROM library_tracks
		WHERE album_id = $1
		ORDER BY disc_number, track_number
	`, albumID))
	if err != nil {
		return nil, err
	}
	trackIDs := make([]int64, 0, len(tracks))
	for _, track := range tracks {
		if id := intValue(track["id"]); id > 0 {
			trackIDs = append(trackIDs, id)
		}
	}
	variantMap, err := s.variantSummaries(ctx, trackIDs)
	if err != nil {
		return nil, err
	}
	lyricsMap, err := s.lyricsStatus(ctx, albumID)
	if err != nil {
		return nil, err
	}
	trackList := make([]map[string]any, 0, len(tracks))
	albumTags := map[string]any{}
	var totalSize int64
	var totalLength int64
	for _, track := range tracks {
		size := intValue(track["size"])
		totalSize += size
		length := int64(math.Round(floatValue(track["duration"])))
		totalLength += length
		trackID := intValue(track["id"])
		if len(albumTags) == 0 && stringValue(track["album"]) != "" {
			albumTags = map[string]any{
				"artist":              firstNonEmpty(stringValue(track["albumartist"]), stringValue(track["artist"])),
				"album":               stringValue(track["album"]),
				"year":                firstN(stringValue(track["year"]), 4),
				"genre":               stringValue(track["genre"]),
				"musicbrainz_albumid": track["musicbrainz_albumid"],
			}
		}
		trackList = append(trackList, map[string]any{
			"id":                    trackID,
			"entity_uid":            track["entity_uid"],
			"storage_id":            track["storage_id"],
			"filename":              stringValue(track["filename"]),
			"format":                stringValue(track["format"]),
			"size_mb":               roundFloat(float64(size)/(1024*1024), 1),
			"bitrate":               bitrateKbps(track["bitrate"]),
			"sample_rate":           track["sample_rate"],
			"bit_depth":             track["bit_depth"],
			"bpm":                   track["bpm"],
			"audio_key":             track["audio_key"],
			"audio_scale":           track["audio_scale"],
			"energy":                track["energy"],
			"danceability":          track["danceability"],
			"valence":               track["valence"],
			"bliss_vector":          normalizeFloatSlice(track["bliss_vector"]),
			"length_sec":            length,
			"popularity":            track["popularity"],
			"popularity_score":      track["popularity_score"],
			"popularity_confidence": track["popularity_confidence"],
			"rating":                intValue(track["rating"]),
			"stream_variants":       variantMap[trackID],
			"lyrics":                lyricsForTrack(lyricsMap, trackID),
			"tags": map[string]any{
				"title":               stringValue(track["title"]),
				"artist":              stringValue(track["artist"]),
				"album":               stringValue(track["album"]),
				"albumartist":         stringValue(track["albumartist"]),
				"tracknumber":         stringValue(track["track_number"]),
				"discnumber":          stringValue(track["disc_number"]),
				"date":                stringValue(track["year"]),
				"genre":               stringValue(track["genre"]),
				"musicbrainz_albumid": stringValue(track["musicbrainz_albumid"]),
				"musicbrainz_trackid": stringValue(track["musicbrainz_trackid"]),
			},
			"path": relativeMusicPath(stringValue(track["path"])),
		})
	}
	genres, profile, err := s.albumGenres(ctx, albumID)
	if err != nil {
		return nil, err
	}
	if len(genres) > 0 {
		albumTags["genre"] = strings.Join(anyStrings(genres), ", ")
	}
	if mbid := stringValue(album["musicbrainz_albumid"]); mbid != "" {
		albumTags["musicbrainz_albumid"] = mbid
	}

	return map[string]any{
		"id":                    albumID,
		"entity_uid":            album["entity_uid"],
		"slug":                  album["slug"],
		"artist_id":             album["artist_id"],
		"artist_entity_uid":     album["artist_entity_uid"],
		"artist_slug":           album["artist_slug"],
		"artist":                stringValue(album["artist"]),
		"name":                  stringValue(album["name"]),
		"display_name":          displayName(stringValue(album["name"])),
		"path":                  stringValue(album["path"]),
		"track_count":           len(tracks),
		"total_size_mb":         int64(math.Round(float64(totalSize) / (1024 * 1024))),
		"total_length_sec":      totalLength,
		"has_cover":             boolValue(album["has_cover"]),
		"cover_file":            nil,
		"tracks":                trackList,
		"album_tags":            albumTags,
		"musicbrainz_albumid":   album["musicbrainz_albumid"],
		"genres":                genres,
		"genre_profile":         profile,
		"popularity":            album["popularity"],
		"popularity_score":      album["popularity_score"],
		"popularity_confidence": album["popularity_confidence"],
	}, nil
}
func (s *Store) albumGenres(ctx context.Context, albumID int64) ([]any, []map[string]any, error) {
	rows, err := rowsToMaps(s.pool.Query(ctx, `
		SELECT g.name, g.slug, ag.weight, ag.source
		FROM album_genres ag
		JOIN genres g ON ag.genre_id = g.id
		WHERE ag.album_id = $1
		ORDER BY ag.weight DESC NULLS LAST, g.name ASC
		LIMIT 8
	`, albumID))
	if err != nil {
		return nil, nil, err
	}
	genres := make([]any, 0, len(rows))
	for _, row := range rows {
		genres = append(genres, stringValue(row["name"]))
	}
	return genres, buildGenreProfile(rows, 6), nil
}
