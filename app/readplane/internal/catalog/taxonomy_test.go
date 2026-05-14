package catalog

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadTaxonomyFromFile(t *testing.T) {
	// Reset to nil so we know LoadTaxonomy actually sets them.
	genreTopLevelMetadata = nil
	staticGenreTopLevel = nil

	tmp := t.TempDir()
	path := filepath.Join(tmp, "taxonomy.json")
	if err := os.WriteFile(path, []byte(`{
		"top_level_metadata": {
			"rock": {"name": "rock", "description": "guitar music"}
		},
		"static_top_level": {
			"metal": "rock"
		}
	}`), 0o644); err != nil {
		t.Fatalf("write failed: %v", err)
	}
	if err := LoadTaxonomy(path); err != nil {
		t.Fatalf("LoadTaxonomy failed: %v", err)
	}

	if len(genreTopLevelMetadata) == 0 {
		t.Fatal("genreTopLevelMetadata is empty")
	}
	if len(staticGenreTopLevel) == 0 {
		t.Fatal("staticGenreTopLevel is empty")
	}
	if _, ok := genreTopLevelMetadata["rock"]; !ok {
		t.Fatal("missing rock metadata")
	}
	if _, ok := staticGenreTopLevel["metal"]; !ok {
		t.Fatal("missing metal static mapping")
	}
}

func TestLoadTaxonomyMissingFile(t *testing.T) {
	err := LoadTaxonomy("/nonexistent/taxonomy.json")
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestLoadTaxonomyInvalidJSON(t *testing.T) {
	tmp := t.TempDir()
	path := filepath.Join(tmp, "bad.json")
	if err := os.WriteFile(path, []byte("not json"), 0o644); err != nil {
		t.Fatalf("write failed: %v", err)
	}
	err := LoadTaxonomy(path)
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}
