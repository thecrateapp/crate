package routes

import (
	"errors"
	"net/http"
	"strings"

	"github.com/thecrateapp/crate/app/readplane/internal/catalog"
	"github.com/thecrateapp/crate/app/readplane/internal/httpx"
	"github.com/thecrateapp/crate/app/readplane/internal/snapshots"
)

func (s *Server) smartMixProfileSummary(
	w http.ResponseWriter,
	r *http.Request,
	entityUID string,
) {
	detail := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("detail")))
	if detail != "" && detail != "summary" {
		s.fallbackOrRouteMiss(w, r)
		return
	}
	if s.smartMixCatalog == nil || s.auth == nil {
		s.catalogUnavailable(w, r, "Smart Mix profile readplane unavailable")
		return
	}
	if _, err := s.auth.Authenticate(r, false); err != nil {
		s.fallbackOrAuthError(w, r, err)
		return
	}

	summary, err := s.smartMixCatalog.SmartMixProfileSummaryByEntityUID(
		r.Context(),
		entityUID,
	)
	if err == nil {
		err = summary.Validate()
	}
	switch {
	case err == nil:
		httpx.MarkReadplane(w, "hit")
		if writeErr := httpx.WriteJSON(w, http.StatusOK, summary); writeErr != nil {
			s.logger.Warn(
				"failed to write Smart Mix profile summary",
				"error",
				writeErr,
			)
		}
	case errors.Is(err, catalog.ErrNotFound):
		httpx.MarkReadplane(w, "hit")
		httpx.WriteError(w, http.StatusNotFound, "Smart Mix profile not found")
	case errors.Is(err, snapshots.ErrSmartMixSnapshotStale):
		s.fallbackOrRouteMiss(w, r)
	default:
		s.logger.Warn(
			"Smart Mix profile summary query failed",
			"entity_uid",
			entityUID,
			"error",
			err,
		)
		if s.tryFallback(w, r) {
			return
		}
		httpx.MarkReadplane(w, "miss")
		httpx.WriteError(
			w,
			http.StatusServiceUnavailable,
			"Smart Mix profile unavailable",
		)
	}
}
