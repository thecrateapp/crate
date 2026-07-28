package routes

import (
	"net/http"

	"github.com/thecrateapp/crate/app/readplane/internal/media"
)

func artworkSize(r *http.Request) int {
	return boundedQueryInt(r, "size", 0, 0, 2048)
}

func (s *Server) catalogArtworkRoute(w http.ResponseWriter, r *http.Request) {
	parts, ok := routeParts(r.URL.Path, "/api/catalog/")
	if !ok || s.artworkCatalog == nil {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	if len(parts) == 3 && parts[0] == "albums" && parts[2] == "cover" {
		if !s.requireCatalogAssetAuth(w, r) {
			return
		}
		key, err := s.artworkCatalog.GlobalAlbumArtworkKey(r.Context(), parts[1])
		s.serveMaterializedArtwork(w, r, "album-cover", key, err)
		return
	}
	if len(parts) == 3 && parts[0] == "artists" && (parts[2] == "photo" || parts[2] == "background") {
		if !s.requireCatalogAssetAuth(w, r) {
			return
		}
		key, err := s.artworkCatalog.GlobalArtistArtworkKey(r.Context(), parts[1])
		s.serveMaterializedArtwork(w, r, artworkKind(parts[2]), key, err)
		return
	}
	s.fallbackOrRouteMiss(w, r)
}

func (s *Server) serveAlbumArtworkByID(w http.ResponseWriter, r *http.Request, id int64) {
	if s.artworkCatalog == nil {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	key, err := s.artworkCatalog.AlbumArtworkKeyByID(r.Context(), id)
	s.serveMaterializedArtwork(w, r, "album-cover", key, err)
}

func (s *Server) serveAlbumArtworkByEntityUID(w http.ResponseWriter, r *http.Request, uid string) {
	s.serveMaterializedArtwork(w, r, "album-cover", uid, nil)
}

func (s *Server) serveArtistArtworkByID(w http.ResponseWriter, r *http.Request, id int64, action string) {
	if s.artworkCatalog == nil {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	key, err := s.artworkCatalog.ArtistArtworkKeyByID(r.Context(), id)
	s.serveMaterializedArtwork(w, r, artworkKind(action), key, err)
}

func (s *Server) serveArtistArtworkByEntityUID(w http.ResponseWriter, r *http.Request, uid, action string) {
	if s.artworkCatalog == nil {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	key, err := s.artworkCatalog.ArtistArtworkKeyByEntityUID(r.Context(), uid)
	s.serveMaterializedArtwork(w, r, artworkKind(action), key, err)
}

func artworkKind(action string) string {
	if action == "background" {
		return "artist-background"
	}
	return "artist-photo"
}

func (s *Server) serveMaterializedArtwork(w http.ResponseWriter, r *http.Request, kind, key string, keyErr error) {
	if keyErr != nil || s.artworkResolver == nil {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	asset, err := s.artworkResolver.Resolve(kind, key, artworkSize(r))
	if err != nil {
		if s.mediaMetrics != nil {
			s.mediaMetrics.RecordNativeArtwork(false, "manifest")
		}
		s.fallbackOrRouteMiss(w, r)
		return
	}
	if s.mediaMetrics != nil {
		s.mediaMetrics.RecordNativeArtwork(true, "")
	}
	w.Header().Set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800")
	w.Header().Set("X-Crate-Artwork", "variant")
	w.Header().Set("X-Crate-Artwork-Revision", asset.Revision)
	descriptor := media.Descriptor{MediaType: asset.MediaType, Category: "artwork"}
	if s.mediaMetrics != nil {
		descriptor.Observer = s.mediaMetrics
	}
	if err := media.ServeFile(w, r, asset.Path, descriptor); err != nil {
		s.fallbackOrRouteMiss(w, r)
	}
}
