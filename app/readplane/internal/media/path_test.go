package media

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResolveUnder(t *testing.T) {
	root := t.TempDir()
	inside := filepath.Join(root, "artist", "track.flac")
	require.NoError(t, os.MkdirAll(filepath.Dir(inside), 0o755))
	require.NoError(t, os.WriteFile(inside, []byte("audio"), 0o644))
	expected, err := filepath.EvalSymlinks(inside)
	require.NoError(t, err)

	for _, stored := range []string{"artist/track.flac", "/music/artist/track.flac", inside} {
		t.Run(stored, func(t *testing.T) {
			got, err := ResolveUnder(root, stored)
			require.NoError(t, err)
			assert.Equal(t, expected, got)
		})
	}

	for _, stored := range []string{"", "../secret", "/etc/passwd", "artist/../..", "artist/\x00bad"} {
		t.Run("reject_"+stored, func(t *testing.T) {
			_, err := ResolveUnder(root, stored)
			assert.ErrorIs(t, err, ErrUnsafePath)
		})
	}
}

func TestResolveUnderRejectsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.flac")
	require.NoError(t, os.WriteFile(secret, []byte("secret"), 0o644))
	require.NoError(t, os.Symlink(outside, filepath.Join(root, "escape")))

	_, err := ResolveUnder(root, "escape/secret.flac")
	assert.ErrorIs(t, err, ErrUnsafePath)
}

func TestResolveUnderRequiresRegularExistingFile(t *testing.T) {
	root := t.TempDir()
	_, err := ResolveUnder(root, "missing.flac")
	assert.ErrorIs(t, err, ErrMediaMissing)
	_, err = ResolveUnder(root, ".")
	assert.ErrorIs(t, err, ErrMediaMissing)
}
