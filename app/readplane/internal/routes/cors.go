package routes

import (
	"net/http"
	"strings"
)

const corsAllowedMethods = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
const corsAllowedHeaders = "Accept, Authorization, Content-Type, If-Modified-Since, If-None-Match, Last-Event-ID, Range, X-Crate-App, X-Device-Fingerprint, X-Device-Label, X-Requested-With"

type corsResponseWriter struct {
	http.ResponseWriter
	origin string
}

func (w *corsResponseWriter) applyHeaders() {
	headers := w.Header()
	headers.Set("Access-Control-Allow-Origin", w.origin)
	headers.Set("Access-Control-Allow-Credentials", "true")
	ensureVaryHeader(headers, "Origin")
}

func (w *corsResponseWriter) WriteHeader(status int) {
	w.applyHeaders()
	w.ResponseWriter.WriteHeader(status)
}

func (w *corsResponseWriter) Write(body []byte) (int, error) {
	w.applyHeaders()
	return w.ResponseWriter.Write(body)
}

func (w *corsResponseWriter) Flush() {
	w.applyHeaders()
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *corsResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	allowedOrigins := make(map[string]struct{}, len(s.cfg.CORSAllowedOrigins))
	for _, origin := range s.cfg.CORSAllowedOrigins {
		allowedOrigins[origin] = struct{}{}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/")
		if _, allowed := allowedOrigins[origin]; !allowed || origin == "" {
			next.ServeHTTP(w, r)
			return
		}

		writer := &corsResponseWriter{ResponseWriter: w, origin: origin}
		if r.Method == http.MethodOptions &&
			strings.TrimSpace(r.Header.Get("Access-Control-Request-Method")) != "" {
			writer.applyHeaders()
			writer.Header().Set("Access-Control-Allow-Methods", corsAllowedMethods)
			writer.Header().Set("Access-Control-Allow-Headers", corsAllowedHeaders)
			writer.Header().Set("Access-Control-Max-Age", "600")
			writer.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(writer, r)
	})
}

func ensureVaryHeader(headers http.Header, value string) {
	for _, existing := range headers.Values("Vary") {
		for _, part := range strings.Split(existing, ",") {
			if strings.EqualFold(strings.TrimSpace(part), value) ||
				strings.TrimSpace(part) == "*" {
				return
			}
		}
	}
	headers.Add("Vary", value)
}
