package assets

import (
	"bytes"
	"os"
	"path/filepath"
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
