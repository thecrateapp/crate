package media

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

var (
	ErrUnsafePath   = errors.New("unsafe media path")
	ErrMediaMissing = errors.New("media file missing")
)

// ResolveUnder resolves an existing regular file and proves that it remains
// beneath root after following symlinks.
func ResolveUnder(root, storedPath string) (string, error) {
	if root == "" || storedPath == "" || strings.ContainsRune(storedPath, '\x00') {
		return "", ErrUnsafePath
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", ErrUnsafePath
	}
	resolvedRoot, err = filepath.Abs(resolvedRoot)
	if err != nil {
		return "", ErrUnsafePath
	}

	storedPath = filepath.Clean(storedPath)
	var candidate string
	if filepath.IsAbs(storedPath) {
		if strings.HasPrefix(storedPath, "/music/") {
			candidate = filepath.Join(resolvedRoot, strings.TrimPrefix(storedPath, "/music/"))
		} else if strings.HasPrefix(storedPath, "/data/") {
			candidate = filepath.Join(resolvedRoot, strings.TrimPrefix(storedPath, "/data/"))
		} else {
			resolvedStored, resolveErr := filepath.EvalSymlinks(storedPath)
			if resolveErr != nil {
				return "", ErrUnsafePath
			}
			rel, relErr := filepath.Rel(resolvedRoot, resolvedStored)
			if relErr != nil || !safeRelative(rel) {
				return "", ErrUnsafePath
			}
			candidate = resolvedStored
		}
	} else {
		if !safeRelative(storedPath) {
			return "", ErrUnsafePath
		}
		candidate = filepath.Join(resolvedRoot, storedPath)
	}

	resolvedCandidate, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", ErrMediaMissing
	}
	rel, err := filepath.Rel(resolvedRoot, resolvedCandidate)
	if err != nil || !safeRelative(rel) {
		return "", ErrUnsafePath
	}
	info, err := os.Stat(resolvedCandidate)
	if err != nil || !info.Mode().IsRegular() {
		return "", ErrMediaMissing
	}
	return resolvedCandidate, nil
}

func safeRelative(path string) bool {
	return path != "" && !filepath.IsAbs(path) && path != ".." && !strings.HasPrefix(path, ".."+string(filepath.Separator))
}
