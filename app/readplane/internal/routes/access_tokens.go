package routes

import (
	"net/http"
	"strings"
)

// accessTokenBearerPrefix marks FastAPI access tokens (VirtualDJ, playback
// continuation and native device tokens). Only FastAPI can validate them and
// enforce their per-type route allowlists; the readplane only knows JWTs.
const accessTokenBearerPrefix = "Bearer crv_"

func hasAccessTokenBearer(r *http.Request) bool {
	return strings.HasPrefix(r.Header.Get("Authorization"), accessTokenBearerPrefix)
}

// shouldFallBackForAccessToken reports whether a request must be handed to
// FastAPI because its credential is an access token the readplane cannot judge.
func shouldFallBackForAccessToken(r *http.Request) bool {
	return strings.HasPrefix(r.URL.Path, "/api/") && hasAccessTokenBearer(r)
}

// withAccessTokenFallback sends every /api/ request carrying a crv_ bearer to
// FastAPI before any native handler runs, so no readplane route answers 401
// for a token FastAPI would accept. Without a usable fallback the native
// handler answers as before.
func (s *Server) withAccessTokenFallback(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if shouldFallBackForAccessToken(r) && s.tryFallback(w, r) {
			return
		}
		next.ServeHTTP(w, r)
	})
}
