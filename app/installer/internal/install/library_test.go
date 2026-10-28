package install

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSummarizeLibraryCountsOnlyAudio(t *testing.T) {
	dir := t.TempDir()
	album := filepath.Join(dir, "Viva Belgrado", "Bellavista")
	os.MkdirAll(album, 0o755)
	os.WriteFile(filepath.Join(album, "01.flac"), make([]byte, 100), 0o644)
	os.WriteFile(filepath.Join(album, "02.MP3"), make([]byte, 50), 0o644)
	os.WriteFile(filepath.Join(album, "cover.jpg"), make([]byte, 999), 0o644)

	got := SummarizeLibrary(dir, time.Second)

	if !got.Exists || got.Files != 2 || got.Bytes != 150 || !got.Complete {
		t.Fatalf("got %+v", got)
	}
}

func TestSummarizeLibraryReportsAMissingFolder(t *testing.T) {
	if got := SummarizeLibrary(filepath.Join(t.TempDir(), "missing"), time.Second); got.Exists {
		t.Fatalf("got %+v", got)
	}
}
