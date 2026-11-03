package assets

import (
	"bytes"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"testing"
)

func TestEmbeddedFilesMatchTheRepository(t *testing.T) {
	root := filepath.Join("..", "..", "..", "..")
	for name, source := range Sources {
		want, err := os.ReadFile(filepath.Join(root, source))
		if err != nil {
			t.Skipf("repository file %s not available: %v", source, err)
		}
		got, err := Read(name)
		if err != nil {
			t.Fatalf("embedded %s: %v", name, err)
		}
		if !bytes.Equal(got, want) {
			t.Errorf("%s is stale; run go generate ./... in app/installer", name)
		}
	}
}

var bundleEntry = regexp.MustCompile(`"([a-z0-9./-]+\.(?:ya?ml|cfg|json))"`)

func TestObservabilityFilesAreTheReleaseBundleAndTheAppOverlays(t *testing.T) {
	script, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "scripts", "observability_release.py"))
	if err != nil {
		t.Fatal(err)
	}
	block := regexp.MustCompile(`(?s)BUNDLE_FILES = tuple\((.*?)\n\)`).FindSubmatch(script)
	if block == nil {
		t.Fatal("BUNDLE_FILES not found in scripts/observability_release.py")
	}
	var want []string
	for _, match := range bundleEntry.FindAllSubmatch(block[1], -1) {
		want = append(want, string(match[1]))
	}
	overlays, err := filepath.Glob(filepath.Join("..", "..", "..", "..", "deploy", "observability", "compose.*.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range overlays {
		name := filepath.Base(path)
		if !slices.Contains(want, name) {
			want = append(want, name)
		}
	}
	slices.Sort(want)
	got := slices.Clone(ObservabilityFiles)
	slices.Sort(got)
	if !slices.Equal(got, want) {
		t.Fatalf("embedded monitoring files %v, want the release bundle and the app overlays %v", got, want)
	}
	for _, name := range ObservabilityFiles {
		if _, err := Read(ObservabilityDir + "/" + name); err != nil {
			t.Errorf("%s is not embedded; run go generate ./...", name)
		}
	}
}
