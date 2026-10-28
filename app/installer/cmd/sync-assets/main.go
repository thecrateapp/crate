// Command sync-assets copies the deployed files into internal/assets/files.
// Run it through `go generate ./...` after changing any of them.
package main

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/thecrateapp/crate/app/installer/internal/assets"
)

func main() {
	root, err := repositoryRoot()
	if err != nil {
		fail(err)
	}
	target := filepath.Join(root, "app", "installer", "internal", "assets", "files")
	for name, source := range assets.Sources {
		data, err := os.ReadFile(filepath.Join(root, source))
		if err != nil {
			fail(err)
		}
		if err := os.WriteFile(filepath.Join(target, name), data, 0o644); err != nil {
			fail(err)
		}
	}
}

func repositoryRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "deploy", "install", "integrations.yaml")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("repository root not found")
		}
		dir = parent
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, "sync-assets:", err)
	os.Exit(1)
}
