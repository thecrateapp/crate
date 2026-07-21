package media

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestServeFileHTTPContract(t *testing.T) {
	path := filepath.Join(t.TempDir(), "track.mp3")
	require.NoError(t, os.WriteFile(path, []byte("0123456789"), 0o644))
	descriptor := Descriptor{MediaType: "audio/mpeg", RequestedPolicy: "original", EffectivePolicy: "original", SourceFormat: "mp3", DeliveryFormat: "mp3"}

	tests := []struct {
		name        string
		method      string
		rangeHeader string
		status      int
		body        string
	}{
		{"full", http.MethodGet, "", 200, "0123456789"},
		{"head", http.MethodHead, "", 200, ""},
		{"range", http.MethodGet, "bytes=2-5", 206, "2345"},
		{"suffix", http.MethodGet, "bytes=-3", 206, "789"},
		{"invalid", http.MethodGet, "bytes=20-30", 416, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, "/stream", nil)
			req.Header.Set("Range", tt.rangeHeader)
			response := httptest.NewRecorder()
			err := ServeFile(response, req, path, descriptor)
			require.NoError(t, err)
			assert.Equal(t, tt.status, response.Code)
			if tt.status != http.StatusRequestedRangeNotSatisfiable {
				assert.Equal(t, tt.body, response.Body.String())
			}
			assert.Equal(t, "bytes", response.Header().Get("Accept-Ranges"))
			if tt.status != http.StatusRequestedRangeNotSatisfiable {
				assert.NotEmpty(t, response.Header().Get("ETag"))
			}
			assert.Equal(t, "hit", response.Header().Get("X-Crate-Readplane"))
		})
	}
}

func TestServeFileHonorsValidators(t *testing.T) {
	path := filepath.Join(t.TempDir(), "track.flac")
	require.NoError(t, os.WriteFile(path, []byte("audio"), 0o644))
	first := httptest.NewRecorder()
	require.NoError(t, ServeFile(first, httptest.NewRequest(http.MethodGet, "/", nil), path, Descriptor{}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("If-None-Match", first.Header().Get("ETag"))
	second := httptest.NewRecorder()
	require.NoError(t, ServeFile(second, req, path, Descriptor{}))
	assert.Equal(t, http.StatusNotModified, second.Code)
}
