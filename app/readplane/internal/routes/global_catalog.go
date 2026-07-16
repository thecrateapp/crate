package routes

import (
	"errors"
	"net/http"

	"github.com/thecrateapp/crate/app/readplane/internal/catalog"
	"github.com/thecrateapp/crate/app/readplane/internal/httpx"
	"github.com/thecrateapp/crate/app/readplane/internal/snapshots"
)

const globalCatalogTaxonomyScope = "global-catalog-taxonomy"
const globalCatalogGenresScope = "global-catalog-genres"
const coreTaxonomySubject = "crate-core"

func (s *Server) globalCatalogSearchRoute(w http.ResponseWriter, r *http.Request) {
	if !s.requireCatalogAuth(w, r) {
		return
	}
	s.serveGlobalCatalogSearch(w, r)
}

func (s *Server) serveGlobalCatalogSearch(w http.ResponseWriter, r *http.Request) {
	limit := boundedQueryInt(r, "limit", 20, 1, 50)
	payload, mode, err := s.catalog.CanonicalSearch(r.Context(), r.URL.Query().Get("q"), limit)
	w.Header().Set("X-Crate-Catalog-Mode", string(mode))
	s.writeCatalogPayload(w, r, payload, err, "Global catalog search unavailable", "Not found")
}

// globalCatalogGenresRoute serves only the catalog-wide genre list. Detail
// routes intentionally remain on FastAPI until their richer entity snapshots
// are published with the same taxonomy revision.
func (s *Server) globalCatalogGenresRoute(w http.ResponseWriter, r *http.Request) {
	if !s.requireCatalogAuth(w, r) {
		return
	}
	mode, err := s.catalog.GlobalCatalogServingMode(r.Context())
	if err != nil {
		s.logger.Warn("readplane catalog serving mode check failed", "error", err)
		mode = catalog.CatalogLocalFallback
	}
	w.Header().Set("X-Crate-Catalog-Mode", string(mode))
	if !catalogGenresUsesSnapshot(mode) {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	if s.snapshots == nil {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	taxonomy, err := s.snapshots.Get(r.Context(), globalCatalogTaxonomyScope, coreTaxonomySubject)
	if err != nil {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	genres, err := s.snapshots.Get(r.Context(), globalCatalogGenresScope, coreTaxonomySubject)
	if err != nil {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	payload, err := globalCatalogGenresPayload(taxonomy, genres)
	if err != nil {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	httpx.MarkReadplane(w, "hit")
	if err := httpx.WriteJSON(w, http.StatusOK, payload); err != nil {
		s.logger.Warn("failed to write global genre JSON", "error", err)
	}
}

func catalogGenresUsesSnapshot(mode catalog.CatalogServingMode) bool {
	return mode.UsesGlobal()
}

func (s *Server) globalCatalogArtistsRoute(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireCatalogUser(w, r)
	if !ok {
		return
	}
	payload, err := s.catalog.FollowedArtists(r.Context(), user.ID)
	s.writeCatalogPayload(w, r, payload, err, "Global artist library unavailable", "Not found")
}

func (s *Server) globalCatalogAlbumsRoute(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requireCatalogUser(w, r)
	if !ok {
		return
	}
	payload, err := s.catalog.SavedAlbums(r.Context(), user.ID)
	s.writeCatalogPayload(w, r, payload, err, "Global album library unavailable", "Not found")
}

func globalCatalogGenresPayload(taxonomy *snapshots.Row, genres *snapshots.Row) (map[string]any, error) {
	if err := snapshots.RequireMatchingTaxonomy(taxonomy, genres); err != nil {
		return nil, err
	}
	payload := make(map[string]any, len(genres.Payload))
	for key, value := range genres.Payload {
		payload[key] = value
	}
	if _, ok := payload["items"]; !ok {
		return nil, errors.New("global genre snapshot has no items")
	}
	return payload, nil
}
