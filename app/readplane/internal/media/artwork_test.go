package media

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func writeArtworkFixture(t *testing.T, dataRoot, kind, key string, variants map[string]string) {
	t.Helper()
	assetRoot := filepath.Join(dataRoot, "artwork-variants", "v1", kind, key)
	require.NoError(t, os.MkdirAll(filepath.Join(assetRoot, "rev"), 0o755))
	for _, rel := range variants {
		path := filepath.Join(assetRoot, rel)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o755))
		require.NoError(t, os.WriteFile(path, []byte("webp"), 0o644))
	}
	payload := map[string]any{"version": 1, "kind": kind, "entity_key": key, "source_revision": "rev", "variants": variants}
	encoded, err := json.Marshal(payload)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(assetRoot, "current.json"), encoded, 0o644))
}

func TestArtworkResolverSelectsPythonCompatibleBuckets(t *testing.T) {
	root := t.TempDir()
	writeArtworkFixture(t, root, "artist-photo", "artist-uid", map[string]string{"128": "rev/128.webp", "384": "rev/384.webp", "1024": "rev/1024.webp"})
	resolver := NewArtworkResolver(root)

	asset, err := resolver.Resolve("artist-photo", "artist-uid", 320)
	require.NoError(t, err)
	assert.Equal(t, 384, asset.Size)
	assert.Equal(t, "rev", asset.Revision)
	assert.Equal(t, "image/webp", asset.MediaType)
}

func TestArtworkResolverRejectsInvalidOrEscapingManifests(t *testing.T) {
	root := t.TempDir()
	writeArtworkFixture(t, root, "album-cover", "album-uid", map[string]string{"128": "../../outside.webp"})
	resolver := NewArtworkResolver(root)
	_, err := resolver.Resolve("album-cover", "album-uid", 128)
	assert.ErrorIs(t, err, ErrArtworkMiss)
	_, err = resolver.Resolve("unknown", "album-uid", 128)
	assert.ErrorIs(t, err, ErrArtworkMiss)
}

func TestArtworkResolverInvalidatesCacheAfterAtomicManifestReplace(t *testing.T) {
	root := t.TempDir()
	writeArtworkFixture(t, root, "album-cover", "album-uid", map[string]string{"128": "rev/128.webp"})
	resolver := NewArtworkResolver(root)
	first, err := resolver.Resolve("album-cover", "album-uid", 128)
	require.NoError(t, err)
	assert.Equal(t, 128, first.Size)
	time.Sleep(time.Millisecond)
	writeArtworkFixture(t, root, "album-cover", "album-uid", map[string]string{"256": "rev/256.webp"})
	second, err := resolver.Resolve("album-cover", "album-uid", 128)
	require.NoError(t, err)
	assert.Equal(t, 256, second.Size)
}
