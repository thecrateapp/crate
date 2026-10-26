package install

import (
	"io/fs"
	"path/filepath"
	"strings"
	"time"
)

var audioExtensions = map[string]bool{
	".flac": true, ".mp3": true, ".m4a": true, ".aac": true, ".ogg": true,
	".opus": true, ".wav": true, ".aiff": true, ".aif": true, ".wv": true,
	".ape": true, ".dsf": true, ".alac": true,
}

type LibrarySummary struct {
	Exists   bool
	Files    int
	Bytes    int64
	Complete bool // false when the time budget ran out
}

// SummarizeLibrary counts audio files under dir for at most budget, so a
// huge library on a slow disk never stalls the wizard.
func SummarizeLibrary(dir string, budget time.Duration) LibrarySummary {
	deadline := time.Now().Add(budget)
	summary := LibrarySummary{Complete: true}
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			if path == dir {
				return err
			}
			return nil
		}
		summary.Exists = true
		if time.Now().After(deadline) {
			summary.Complete = false
			return filepath.SkipAll
		}
		if entry.IsDir() || !audioExtensions[strings.ToLower(filepath.Ext(path))] {
			return nil
		}
		summary.Files++
		if info, err := entry.Info(); err == nil {
			summary.Bytes += info.Size()
		}
		return nil
	})
	if err != nil {
		return LibrarySummary{}
	}
	return summary
}
