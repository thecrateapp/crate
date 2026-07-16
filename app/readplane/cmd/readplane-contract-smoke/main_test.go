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
