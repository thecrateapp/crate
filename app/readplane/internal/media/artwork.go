package media

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
)

var ErrArtworkMiss = errors.New("materialized artwork miss")

var artworkMaximum = map[string]int{
	"album-cover": 1024, "artist-photo": 1024, "artist-background": 2048,
	"external-artist": 768, "genre-cover": 2048, "release-cover": 1024,
}

type artworkManifest struct {
	Version        int               `json:"version"`
	Kind           string            `json:"kind"`
	EntityKey      string            `json:"entity_key"`
	SourceRevision string            `json:"source_revision"`
	Variants       map[string]string `json:"variants"`
}

type ResolvedArtwork struct {
	Path      string
	Size      int
	Revision  string
	MediaType string
}

type cachedManifest struct {
	mtimeNS  int64
	manifest artworkManifest
}

type ArtworkResolver struct {
	dataRoot string
	mu       sync.RWMutex
	cache    map[string]cachedManifest
}

func NewArtworkResolver(dataRoot string) *ArtworkResolver {
	return &ArtworkResolver{dataRoot: dataRoot, cache: make(map[string]cachedManifest)}
}

func (r *ArtworkResolver) Resolve(kind, entityKey string, requestedSize int) (ResolvedArtwork, error) {
	maximum, ok := artworkMaximum[kind]
	if !ok || !safeArtworkKey(entityKey) {
		return ResolvedArtwork{}, ErrArtworkMiss
	}
	assetRoot := filepath.Join(r.dataRoot, "artwork-variants", "v1", kind, entityKey)
	manifestPath := filepath.Join(assetRoot, "current.json")
	info, err := os.Stat(manifestPath)
	if err != nil || !info.Mode().IsRegular() {
		return ResolvedArtwork{}, ErrArtworkMiss
	}
	manifest, err := r.load(manifestPath, info.ModTime().UnixNano())
	if err != nil || manifest.Version != 1 || manifest.Kind != kind || manifest.EntityKey != entityKey || manifest.SourceRevision == "" {
		return ResolvedArtwork{}, ErrArtworkMiss
	}
	sizes := make([]int, 0, len(manifest.Variants))
	for raw := range manifest.Variants {
		size, parseErr := strconv.Atoi(raw)
		if parseErr == nil && size > 0 && size <= maximum {
			sizes = append(sizes, size)
		}
	}
	if len(sizes) == 0 {
		return ResolvedArtwork{}, ErrArtworkMiss
	}
	sort.Ints(sizes)
	target := maximum
	if requestedSize > 0 {
		target = requestedSize
	}
	selected := sizes[len(sizes)-1]
	for _, size := range sizes {
		if size >= target {
			selected = size
			break
		}
	}
	relative := manifest.Variants[strconv.Itoa(selected)]
	path, err := ResolveUnder(assetRoot, relative)
	if err != nil {
		return ResolvedArtwork{}, ErrArtworkMiss
	}
	return ResolvedArtwork{Path: path, Size: selected, Revision: manifest.SourceRevision, MediaType: "image/webp"}, nil
}

func (r *ArtworkResolver) load(path string, mtimeNS int64) (artworkManifest, error) {
	r.mu.RLock()
	cached, ok := r.cache[path]
	r.mu.RUnlock()
	if ok && cached.mtimeNS == mtimeNS {
		return cached.manifest, nil
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return artworkManifest{}, err
	}
	var manifest artworkManifest
	if json.Unmarshal(content, &manifest) != nil {
		return artworkManifest{}, ErrArtworkMiss
	}
	r.mu.Lock()
	if len(r.cache) >= 2048 {
		r.cache = make(map[string]cachedManifest)
	}
	r.cache[path] = cachedManifest{mtimeNS: mtimeNS, manifest: manifest}
	r.mu.Unlock()
	return manifest, nil
}

func safeArtworkKey(value string) bool {
	return value != "" && value != "." && value != ".." && !strings.ContainsAny(value, "/\\\x00")
}
