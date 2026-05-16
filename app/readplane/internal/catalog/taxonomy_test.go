package catalog

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestLoadTaxonomy(t *testing.T) {
	t.Run("loads from file", func(t *testing.T) {
		genreTopLevelMetadata = nil
		staticGenreTopLevel = nil

		tmp := t.TempDir()
		path := filepath.Join(tmp, "taxonomy.json")
		err := os.WriteFile(path, []byte(`{
			"top_level_metadata": {
				"rock": {"name": "rock", "description": "guitar music"}
			},
			"static_top_level": {
				"metal": "rock"
			}
		}`), 0o644)
		assert.NoError(t, err)
		assert.NoError(t, LoadTaxonomy(path))

		assert.NotEmpty(t, genreTopLevelMetadata)
		assert.NotEmpty(t, staticGenreTopLevel)
		_, rok := genreTopLevelMetadata["rock"]
		assert.True(t, rok, "missing rock metadata")
		_, mok := staticGenreTopLevel["metal"]
		assert.True(t, mok, "missing metal static mapping")
	})

	t.Run("errors on missing file", func(t *testing.T) {
		err := LoadTaxonomy("/nonexistent/taxonomy.json")
		assert.Error(t, err, "expected error for missing file")
	})

	t.Run("errors on invalid JSON", func(t *testing.T) {
		tmp := t.TempDir()
		path := filepath.Join(tmp, "bad.json")
		err := os.WriteFile(path, []byte("not json"), 0o644)
		assert.NoError(t, err)
		assert.Error(t, LoadTaxonomy(path), "expected error for invalid JSON")
	})
}
