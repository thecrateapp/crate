package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestValidateCatalogMode(t *testing.T) {
	for _, mode := range []string{"local-fallback", "global-ready", "global-refreshing", "global-degraded"} {
		assert.NoError(t, validateCatalogMode("/api/catalog/search?q=high", mode))
	}
	assert.Error(t, validateCatalogMode("/api/catalog/search?q=high", ""))
	assert.Error(t, validateCatalogMode("/api/catalog/search?q=high", "warming"))
	assert.NoError(t, validateCatalogMode("/api/catalog/genres", ""))
}

func TestCompareMediaResult(t *testing.T) {
	base := mediaResult{status: 206, contentType: "audio/flac", contentRange: "bytes 0-3/10", body: []byte("test"), headers: map[string]string{"X-Crate-Delivery-Policy": "original"}}
	assert.NoError(t, compareMediaResult(base, base))
	changed := base
	changed.body = []byte("fail")
	assert.Error(t, compareMediaResult(base, changed))
	assert.Equal(t, []string{"/a", "/b"}, splitPaths(" /a, /b "))
}
