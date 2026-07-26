package routes

import (
	"errors"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/thecrateapp/crate/app/readplane/internal/auth"
	"github.com/thecrateapp/crate/app/readplane/internal/catalog"
	"github.com/thecrateapp/crate/app/readplane/internal/httpx"
	"github.com/thecrateapp/crate/app/readplane/internal/media"
)

var routeUUIDRE = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func (s *Server) searchRoute(w http.ResponseWriter, r *http.Request) {
	if !s.requireCatalogAuth(w, r) {
		return
	}
	limit := boundedQueryInt(r, "limit", 20, 1, 50)
	payload, err := s.catalog.Search(r.Context(), r.URL.Query().Get("q"), limit)
	s.writeCatalogPayload(w, r, payload, err, "Search unavailable", "Not found")
}

func (s *Server) favoritesRoute(w http.ResponseWriter, r *http.Request) {
	if !s.requireCatalogAuth(w, r) {
		return
	}
	payload, err := s.catalog.Favorites(r.Context())
	s.writeCatalogPayload(w, r, payload, err, "Favorites unavailable", "Not found")
}

func (s *Server) myLibraryRoute(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireCatalogUser(w, r)
	if !ok {
		return
	}
	payload, err := s.catalog.UserLibraryCounts(r.Context(), user.ID)
	s.writeCatalogPayload(w, r, payload, err, "Library counts unavailable", "Not found")
}

func (s *Server) myFollowsRoute(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireCatalogUser(w, r)
	if !ok {
		return
	}
	payload, err := s.catalog.FollowedArtists(r.Context(), user.ID)
	s.writeCatalogPayload(w, r, payload, err, "Follows unavailable", "Not found")
}

func (s *Server) myFollowStateRoute(w http.ResponseWriter, r *http.Request) {
	parts, ok := routeParts(r.URL.Path, "/api/me/follows/")
	if !ok || len(parts) == 0 {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	user, ok := s.requireCatalogUser(w, r)
	if !ok {
		return
	}
	if len(parts) == 2 && parts[0] == "artists" {
		artistID, ok := parsePositiveInt64(parts[1])
		if !ok {
			s.fallbackOrRouteMiss(w, r)
			return
		}
		payload, err := s.catalog.IsFollowingArtistID(r.Context(), user.ID, artistID)
		s.writeCatalogPayload(w, r, payload, err, "Follow state unavailable", "Artist not found")
		return
	}
	if len(parts) == 1 {
		payload, err := s.catalog.IsFollowingArtistName(r.Context(), user.ID, parts[0])
		s.writeCatalogPayload(w, r, payload, err, "Follow state unavailable", "Not found")
		return
	}
	s.fallbackOrRouteMiss(w, r)
}

func (s *Server) myAlbumsRoute(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireCatalogUser(w, r)
	if !ok {
		return
	}
	payload, err := s.catalog.SavedAlbums(r.Context(), user.ID)
	s.writeCatalogPayload(w, r, payload, err, "Saved albums unavailable", "Not found")
}

func (s *Server) myHistoryRoute(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireCatalogUser(w, r)
	if !ok {
		return
	}
	limit := boundedQueryInt(r, "limit", 50, 1, 500)
	payload, err := s.catalog.PlayHistory(r.Context(), user.ID, limit)
	s.writeCatalogPayload(w, r, payload, err, "Play history unavailable", "Not found")
}

func (s *Server) myLikesRoute(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireCatalogUser(w, r)
	if !ok {
		return
	}
	limit := 100
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			s.fallbackOrRouteMiss(w, r)
			return
		}
		limit = parsed
	}
	payload, err := s.catalog.LikedTracks(r.Context(), user.ID, limit)
	s.writeCatalogPayload(w, r, payload, err, "Liked tracks unavailable", "Not found")
}

func (s *Server) genresRoute(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/api/genres" {
		if !s.requireCatalogAuth(w, r) {
			return
		}
		payload, err := s.catalog.Genres(r.Context())
		s.writeCatalogPayload(w, r, payload, err, "Genres unavailable", "Genre not found")
		return
	}
	parts, ok := routeParts(r.URL.Path, "/api/genres/")
	if !ok || len(parts) == 0 {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	if len(parts) == 1 && !isReservedGenreRoute(parts[0]) {
		user, ok := s.requireCatalogUser(w, r)
		if !ok {
			return
		}
		payload, err := s.catalog.GenreDetail(r.Context(), parts[0], user.ID)
		s.writeCatalogPayload(w, r, payload, err, "Genre unavailable", "Genre not found")
		return
	}
	s.fallbackOrRouteMiss(w, r)
}

func (s *Server) albumRoute(w http.ResponseWriter, r *http.Request) {
	parts, ok := routeParts(r.URL.Path, "/api/albums/")
	if !ok {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	if len(parts) == 2 && parts[1] == "cover" {
		albumID, valid := parsePositiveInt64(parts[0])
		if !valid {
			s.fallbackOrRouteMiss(w, r)
			return
		}
		if !s.requireCatalogAuth(w, r) {
			return
		}
		s.serveAlbumArtworkByID(w, r, albumID)
		return
	}
	if len(parts) == 3 && parts[0] == "by-entity" && parts[2] == "cover" && isRouteUUID(parts[1]) {
		if !s.requireCatalogAuth(w, r) {
			return
		}
		s.serveAlbumArtworkByEntityUID(w, r, parts[1])
		return
	}
	if len(parts) == 1 {
		albumID, ok := parsePositiveInt64(parts[0])
		if !ok {
			s.fallbackOrRouteMiss(w, r)
			return
		}
		if !s.requireCatalogAuth(w, r) {
			return
		}
		payload, err := s.catalog.AlbumByID(r.Context(), albumID)
		s.writeCatalogPayload(w, r, payload, err, "Album unavailable", "Not found")
		return
	}
	if len(parts) == 2 && parts[0] == "by-entity" && isRouteUUID(parts[1]) {
		if !s.requireCatalogAuth(w, r) {
			return
		}
		payload, err := s.catalog.AlbumByEntityUID(r.Context(), parts[1])
		s.writeCatalogPayload(w, r, payload, err, "Album unavailable", "Not found")
		return
	}
	s.fallbackOrRouteMiss(w, r)
}

func (s *Server) artistSlugRoute(w http.ResponseWriter, r *http.Request) {
	parts, ok := routeParts(r.URL.Path, "/api/artist-slugs/")
	if !ok || len(parts) == 0 {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	if len(parts) == 1 {
		if !s.requireCatalogAuth(w, r) {
			return
		}
		payload, err := s.catalog.ArtistBySlug(r.Context(), parts[0])
		s.writeCatalogPayload(w, r, payload, err, "Artist unavailable", "Not found")
		return
	}
	if len(parts) == 2 && parts[1] == "top-tracks" {
		if !s.requireCatalogAuth(w, r) {
			return
		}
		s.writeArtistTopTracks(w, r)
		return
	}
	if len(parts) == 3 && parts[1] == "albums" {
		if !s.requireCatalogAuth(w, r) {
			return
		}
		if s.tryFallback(w, r) {
			return
		}
		payload, err := s.catalog.AlbumByArtistAndAlbumSlug(r.Context(), parts[0], parts[2])
		s.writeCatalogPayloadOrFallbackNotFound(w, r, payload, err, "Album unavailable", "Not found")
		return
	}
	s.fallbackOrRouteMiss(w, r)
}

func (s *Server) writeArtistTopTracks(w http.ResponseWriter, r *http.Request) {
	if s.tryFallback(w, r) {
		return
	}
	s.catalogUnavailable(w, r, "Artist top tracks unavailable")
}

func (s *Server) artistRoute(w http.ResponseWriter, r *http.Request) {
	parts, ok := routeParts(r.URL.Path, "/api/artists/")
	if !ok || len(parts) == 0 {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	if len(parts) == 2 && (parts[1] == "photo" || parts[1] == "background") {
		artistID, valid := parsePositiveInt64(parts[0])
		if !valid {
			s.fallbackOrRouteMiss(w, r)
			return
		}
		if !s.requireCatalogAuth(w, r) {
			return
		}
		s.serveArtistArtworkByID(w, r, artistID, parts[1])
		return
	}
	if len(parts) == 3 && parts[0] == "by-entity" && (parts[2] == "photo" || parts[2] == "background") && isRouteUUID(parts[1]) {
		if !s.requireCatalogAuth(w, r) {
			return
		}
		s.serveArtistArtworkByEntityUID(w, r, parts[1], parts[2])
		return
	}
	if len(parts) == 1 {
		artistID, ok := parsePositiveInt64(parts[0])
		if !ok {
			s.fallbackOrRouteMiss(w, r)
			return
		}
		if !s.requireCatalogAuth(w, r) {
			return
		}
		payload, err := s.catalog.ArtistByID(r.Context(), artistID)
		s.writeCatalogPayload(w, r, payload, err, "Artist unavailable", "Not found")
		return
	}
	if len(parts) == 2 && parts[1] == "top-tracks" {
		_, ok := parsePositiveInt64(parts[0])
		if !ok {
			s.fallbackOrRouteMiss(w, r)
			return
		}
		if !s.requireCatalogAuth(w, r) {
			return
		}
		s.writeArtistTopTracks(w, r)
		return
	}
	if len(parts) == 2 && parts[0] == "by-entity" && isRouteUUID(parts[1]) {
		if !s.requireCatalogAuth(w, r) {
			return
		}
		payload, err := s.catalog.ArtistByEntityUID(r.Context(), parts[1])
		s.writeCatalogPayload(w, r, payload, err, "Artist unavailable", "Not found")
		return
	}
	if len(parts) == 3 && parts[0] == "by-entity" && parts[2] == "top-tracks" && isRouteUUID(parts[1]) {
		if !s.requireCatalogAuth(w, r) {
			return
		}
		s.writeArtistTopTracks(w, r)
		return
	}
	s.fallbackOrRouteMiss(w, r)
}

func (s *Server) trackRoute(w http.ResponseWriter, r *http.Request) {
	parts, ok := routeParts(r.URL.Path, "/api/tracks/")
	if !ok || len(parts) == 0 {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	if len(parts) == 2 {
		trackID, ok := parsePositiveInt64(parts[0])
		if !ok {
			s.fallbackOrRouteMiss(w, r)
			return
		}
		s.trackByIDRoute(w, r, trackID, parts[1])
		return
	}
	if len(parts) == 3 && parts[0] == "by-entity" && isRouteUUID(parts[1]) {
		s.trackByEntityRoute(w, r, parts[1], parts[2])
		return
	}
	s.fallbackOrRouteMiss(w, r)
}

func (s *Server) trackByIDRoute(w http.ResponseWriter, r *http.Request, trackID int64, action string) {
	if action == "stream" {
		if !s.requireCatalogAuth(w, r) {
			return
		}
		s.serveLocalMediaByID(w, r, trackID)
		return
	}
	if action == "playback" && !wantsOriginalDelivery(r) {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	if action != "info" && action != "playback" && action != "eq-features" && action != "genre" {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	if !s.requireCatalogAuth(w, r) {
		return
	}
	if action == "info" {
		payload, err := s.catalog.TrackInfoByID(r.Context(), trackID)
		s.writeCatalogPayload(w, r, payload, err, "Track info unavailable", "Track not found")
		return
	}
	if action == "eq-features" {
		payload, err := s.catalog.TrackEQFeaturesByID(r.Context(), trackID)
		s.writeCatalogPayload(w, r, payload, err, "Track EQ features unavailable", "Track not found")
		return
	}
	if action == "genre" {
		payload, err := s.catalog.TrackGenreByID(r.Context(), trackID)
		s.writeCatalogPayload(w, r, payload, err, "Track genre unavailable", "Track not found")
		return
	}
	payload, err := s.catalog.TrackPlaybackByID(r.Context(), trackID)
	s.writeCatalogPayload(w, r, payload, err, "Track playback unavailable", "Track not found")
}

func (s *Server) trackByEntityRoute(w http.ResponseWriter, r *http.Request, entityUID string, action string) {
	if action == "stream" {
		if !s.requireCatalogAuth(w, r) {
			return
		}
		s.serveLocalMediaByEntityUID(w, r, entityUID)
		return
	}
	if action == "playback" && !wantsOriginalDelivery(r) {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	if action != "info" && action != "playback" && action != "eq-features" && action != "genre" {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	if !s.requireCatalogAuth(w, r) {
		return
	}
	if action == "info" {
		payload, err := s.catalog.TrackInfoByEntityUID(r.Context(), entityUID)
		s.writeCatalogPayload(w, r, payload, err, "Track info unavailable", "Track not found")
		return
	}
	if action == "eq-features" {
		payload, err := s.catalog.TrackEQFeaturesByEntityUID(r.Context(), entityUID)
		s.writeCatalogPayload(w, r, payload, err, "Track EQ features unavailable", "Track not found")
		return
	}
	if action == "genre" {
		payload, err := s.catalog.TrackGenreByEntityUID(r.Context(), entityUID)
		s.writeCatalogPayload(w, r, payload, err, "Track genre unavailable", "Track not found")
		return
	}
	payload, err := s.catalog.TrackPlaybackByEntityUID(r.Context(), entityUID)
	s.writeCatalogPayload(w, r, payload, err, "Track playback unavailable", "Track not found")
}

func requestedDelivery(r *http.Request) string {
	policy := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("delivery")))
	if policy == "" {
		return "original"
	}
	return policy
}

func (s *Server) serveLocalMediaByID(w http.ResponseWriter, r *http.Request, trackID int64) {
	if !s.cfg.LocalMediaEnabled || s.localMedia == nil {
		if s.mediaMetrics != nil {
			s.mediaMetrics.RecordFallback("disabled")
		}
		s.fallbackOrRouteMiss(w, r)
		return
	}
	descriptor, err := s.localMedia.LocalMediaByID(r.Context(), trackID, requestedDelivery(r))
	s.serveLocalMedia(w, r, descriptor, err)
}

func (s *Server) serveLocalMediaByEntityUID(w http.ResponseWriter, r *http.Request, uid string) {
	if !s.cfg.LocalMediaEnabled || s.localMedia == nil {
		if s.mediaMetrics != nil {
			s.mediaMetrics.RecordFallback("disabled")
		}
		s.fallbackOrRouteMiss(w, r)
		return
	}
	descriptor, err := s.localMedia.LocalMediaByEntityUID(r.Context(), uid, requestedDelivery(r))
	s.serveLocalMedia(w, r, descriptor, err)
}

func (s *Server) serveLocalMedia(w http.ResponseWriter, r *http.Request, descriptor catalog.LocalMediaDescriptor, resolveErr error) {
	if resolveErr != nil {
		if s.mediaMetrics != nil {
			s.mediaMetrics.RecordFallback("descriptor")
		}
		s.fallbackOrRouteMiss(w, r)
		return
	}
	root := s.cfg.MusicRoot
	if descriptor.Root == "data" {
		root = s.cfg.CacheRoot
	}
	path, err := media.ResolveUnder(root, descriptor.StoredPath)
	if err != nil {
		if s.mediaMetrics != nil {
			s.mediaMetrics.RecordFallback("path")
		}
		s.fallbackOrRouteMiss(w, r)
		return
	}
	if descriptor.Transcoded {
		source, sourceErr := media.ResolveUnder(s.cfg.MusicRoot, descriptor.SourcePath)
		if sourceErr != nil {
			if s.mediaMetrics != nil {
				s.mediaMetrics.RecordFallback("source_path")
			}
			s.fallbackOrRouteMiss(w, r)
			return
		}
		info, statErr := os.Stat(source)
		if statErr != nil || info.Size() != descriptor.SourceSize || info.ModTime().UnixNano() != descriptor.SourceMtimeNS {
			if s.mediaMetrics != nil {
				s.mediaMetrics.RecordFallback("stale_variant")
			}
			s.fallbackOrRouteMiss(w, r)
			return
		}
	}
	if err := media.ServeFile(w, r, path, s.mediaDescriptor(descriptor)); err != nil {
		s.fallbackOrRouteMiss(w, r)
	}
}

func (s *Server) requireCatalogAuth(w http.ResponseWriter, r *http.Request) bool {
	_, ok := s.requireCatalogUser(w, r)
	return ok
}

func (s *Server) requireCatalogUser(w http.ResponseWriter, r *http.Request) (*auth.User, bool) {
	if s.catalog == nil || s.auth == nil {
		s.catalogUnavailable(w, r, "Readplane catalog unavailable")
		return nil, false
	}
	user, err := s.auth.Authenticate(r, false)
	if err != nil {
		if errors.Is(err, auth.ErrUnauthorized) {
			httpx.MarkReadplane(w, "miss")
			httpx.WriteError(w, http.StatusUnauthorized, "Not authenticated")
			return nil, false
		}
		s.catalogUnavailable(w, r, "Readplane authentication unavailable")
		return nil, false
	}
	return user, true
}

func (s *Server) writeCatalogPayload(w http.ResponseWriter, r *http.Request, payload any, err error, fallbackDetail string, notFoundDetail string) {
	if err == nil {
		httpx.MarkReadplane(w, "hit")
		if err := httpx.WriteJSON(w, http.StatusOK, payload); err != nil {
			s.logger.Warn("failed to write JSON response", "path", r.URL.Path, "error", err)
			_ = httpx.WriteError(w, http.StatusInternalServerError, "Internal server error")
		}
		return
	}
	if errors.Is(err, catalog.ErrNotFound) {
		httpx.MarkReadplane(w, "hit")
		httpx.WriteError(w, http.StatusNotFound, notFoundDetail)
		return
	}
	s.logger.Warn("readplane catalog query failed", "path", r.URL.Path, "error", err)
	if s.tryFallback(w, r) {
		return
	}
	httpx.MarkReadplane(w, "miss")
	httpx.WriteError(w, http.StatusServiceUnavailable, fallbackDetail)
}

func (s *Server) writeCatalogPayloadOrFallbackNotFound(w http.ResponseWriter, r *http.Request, payload any, err error, fallbackDetail string, notFoundDetail string) {
	if errors.Is(err, catalog.ErrNotFound) && s.tryFallback(w, r) {
		return
	}
	s.writeCatalogPayload(w, r, payload, err, fallbackDetail, notFoundDetail)
}

func (s *Server) catalogUnavailable(w http.ResponseWriter, r *http.Request, detail string) {
	if s.tryFallback(w, r) {
		return
	}
	httpx.MarkReadplane(w, "miss")
	httpx.WriteError(w, http.StatusServiceUnavailable, detail)
}

func (s *Server) fallbackOrRouteMiss(w http.ResponseWriter, r *http.Request) {
	if s.tryFallback(w, r) {
		return
	}
	httpx.MarkReadplane(w, "miss")
	httpx.WriteError(w, http.StatusNotFound, "Not found")
}

func (s *Server) tryFallback(w http.ResponseWriter, r *http.Request) bool {
	return s.fallback != nil && s.fallback.ServeHTTP(w, r)
}

func routeParts(path string, prefix string) ([]string, bool) {
	if !strings.HasPrefix(path, prefix) {
		return nil, false
	}
	rest := strings.TrimSuffix(strings.TrimPrefix(path, prefix), "/")
	if rest == "" {
		return []string{}, true
	}
	rawParts := strings.Split(rest, "/")
	parts := make([]string, 0, len(rawParts))
	for _, rawPart := range rawParts {
		if rawPart == "" {
			return nil, false
		}
		part, err := url.PathUnescape(rawPart)
		if err != nil {
			return nil, false
		}
		parts = append(parts, part)
	}
	return parts, true
}

func parsePositiveInt64(value string) (int64, bool) {
	parsed, err := strconv.ParseInt(value, 10, 64)
	return parsed, err == nil && parsed > 0
}

func boundedQueryInt(r *http.Request, key string, fallback int, minValue int, maxValue int) int {
	value := strings.TrimSpace(r.URL.Query().Get(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	if parsed < minValue {
		return minValue
	}
	if parsed > maxValue {
		return maxValue
	}
	return parsed
}

func wantsOriginalDelivery(r *http.Request) bool {
	delivery := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("delivery")))
	return delivery == "" || strings.ReplaceAll(delivery, "-", "_") == "original"
}

func isReservedGenreRoute(value string) bool {
	switch value {
	case "unmapped", "taxonomy", "index", "infer", "descriptions", "musicbrainz", "eq-preset", "suggest-eq-preset":
		return true
	default:
		return false
	}
}

func isRouteUUID(value string) bool {
	return routeUUIDRE.MatchString(strings.TrimSpace(value))
}
