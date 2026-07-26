package routes

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/thecrateapp/crate/app/readplane/internal/httpx"
	"github.com/thecrateapp/crate/app/readplane/internal/snapshots"
)

var statsDashboardLimits = []struct {
	name         string
	defaultValue int
}{
	{name: "tracks_limit", defaultValue: 12},
	{name: "artists_limit", defaultValue: 10},
	{name: "albums_limit", defaultValue: 12},
	{name: "genres_limit", defaultValue: 10},
	{name: "replay_limit", defaultValue: 36},
}

func statsDashboardSubjectKey(userID int64, query url.Values) (string, error) {
	window := strings.ToLower(strings.TrimSpace(query.Get("window")))
	if window == "" {
		window = "30d"
	}
	switch window {
	case "7d", "30d", "90d", "365d", "all_time":
	default:
		return "", fmt.Errorf("unsupported stats window: %s", window)
	}

	month := strings.TrimSpace(query.Get("month"))
	period := window
	monthKey := "default"
	if month != "" {
		parsed, err := time.Parse("2006-01", month)
		if err != nil || parsed.Format("2006-01") != month {
			return "", fmt.Errorf("unsupported stats month: %s", month)
		}
		period = "month:" + month
		monthKey = month
	}

	limits := make([]int, 0, len(statsDashboardLimits))
	for _, spec := range statsDashboardLimits {
		value := spec.defaultValue
		if raw := strings.TrimSpace(query.Get(spec.name)); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed < 1 || parsed > 100 {
				return "", fmt.Errorf("invalid %s", spec.name)
			}
			value = parsed
		}
		limits = append(limits, value)
	}

	return fmt.Sprintf(
		"user:%d:%s:%s:%d:%d:%d:%d:%d",
		userID,
		period,
		monthKey,
		limits[0],
		limits[1],
		limits[2],
		limits[3],
		limits[4],
	), nil
}

func (s *Server) statsDashboard(w http.ResponseWriter, r *http.Request) {
	user, err := s.auth.Authenticate(r, false)
	if err != nil {
		s.fallbackOrAuthError(w, r, err)
		return
	}
	subjectKey, err := statsDashboardSubjectKey(user.ID, r.URL.Query())
	if err != nil {
		if s.tryFallback(w, r) {
			return
		}
		httpx.MarkReadplane(w, "miss")
		httpx.WriteError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	if s.snapshots == nil {
		if s.tryFallback(w, r) {
			return
		}
		httpx.MarkReadplane(w, "miss")
		httpx.WriteError(w, http.StatusServiceUnavailable, "Stats dashboard snapshot store unavailable")
		return
	}
	row, err := s.snapshots.Get(r.Context(), "stats:dashboard", subjectKey)
	if err != nil {
		if s.tryFallback(w, r) {
			return
		}
		status := http.StatusServiceUnavailable
		detail := "Stats dashboard snapshot unavailable"
		if errors.Is(err, snapshots.ErrNotFound) {
			status = http.StatusNotFound
			detail = "Stats dashboard snapshot not found"
		}
		httpx.MarkReadplane(w, "miss")
		httpx.WriteError(w, status, detail)
		return
	}
	httpx.MarkReadplane(w, "hit")
	if err := httpx.WriteJSON(w, http.StatusOK, row.DecoratedPayload()); err != nil {
		s.logger.Warn("failed to write stats dashboard JSON", "error", err)
	}
}
