package manifest

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
)

const repoRoot = "../../../.."

// Everything that can read a variable: services, compose files, build and
// deploy tooling. Documentation is excluded on purpose.
var sourceRoots = []string{
	"app/crate", "app/readplane", "app/media-worker", "app/installer", "app/ui/src", "app/listen/src",
	"app/shared", "app/cast-receiver", "app/listen-desktop", "app/web", "app/docs/src", "app/Dockerfile",
	"app/config.yaml", "tools/crate-cli", "scripts", "deploy", ".github", "Makefile",
	"docker-compose.yaml", "docker-compose.home.yaml", "docker-compose.dev.yaml",
	"docker-compose.local-stack.yaml", "docker-compose.project.yaml", "docker-compose.test.yaml",
	"docker-compose.federation-dev.yaml", "docker-compose.readplane.dev.yaml",
	"docker-compose.opensubsonic-smoke.yaml",
}

var sourceExtensions = map[string]bool{
	".py": true, ".go": true, ".rs": true, ".ts": true, ".tsx": true, ".mjs": true, ".js": true,
	".yaml": true, ".yml": true, ".sh": true, ".toml": true, ".json": true, ".conf": true, "": true,
}

var (
	corpusOnce sync.Once
	corpus     string
)

func sources(t *testing.T) string {
	t.Helper()
	if _, err := os.Stat(filepath.Join(repoRoot, ".env.example")); err != nil {
		t.Skip("repository not available")
	}
	corpusOnce.Do(func() {
		var b strings.Builder
		for _, root := range sourceRoots {
			filepath.WalkDir(filepath.Join(repoRoot, root), func(path string, entry fs.DirEntry, err error) error {
				if err != nil {
					return nil
				}
				name := entry.Name()
				if entry.IsDir() {
					if name == "node_modules" || name == "dist" || name == "target" || name == "files" || strings.HasPrefix(name, ".") && name != ".github" {
						return filepath.SkipDir
					}
					return nil
				}
				if !sourceExtensions[filepath.Ext(name)] || strings.HasSuffix(name, ".md") {
					return nil
				}
				if data, err := os.ReadFile(path); err == nil && len(data) < 4<<20 {
					b.Write(data)
					b.WriteByte('\n')
				}
				return nil
			})
		}
		corpus = b.String()
	})
	return corpus
}

func unread(t *testing.T, names []string) []string {
	text := sources(t)
	var missing []string
	for _, name := range names {
		if !regexp.MustCompile(`\b` + regexp.QuoteMeta(name) + `\b`).MatchString(text) {
			missing = append(missing, name)
		}
	}
	return missing
}

func TestEnvExampleListsOnlyVariablesSomethingReads(t *testing.T) {
	sources(t)
	data, err := os.ReadFile(filepath.Join(repoRoot, ".env.example"))
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, match := range regexp.MustCompile(`(?m)^([A-Z][A-Z0-9_]*)=`).FindAllStringSubmatch(string(data), -1) {
		names = append(names, match[1])
	}
	if missing := unread(t, names); len(missing) > 0 {
		t.Errorf(".env.example lists variables nothing reads: %s", strings.Join(missing, ", "))
	}
}

func TestReadmeOnlyDocumentsRealVariables(t *testing.T) {
	sources(t)
	data, err := os.ReadFile(filepath.Join(repoRoot, "README.md"))
	if err != nil {
		t.Fatal(err)
	}
	section := string(data)
	start := strings.Index(section, "## Configuration")
	end := strings.Index(section, "## Repository map")
	if start < 0 || end < start {
		t.Fatal("README lost its Configuration section")
	}
	var names []string
	for _, match := range regexp.MustCompile("`([A-Z][A-Z0-9_]{2,})`").FindAllStringSubmatch(section[start:end], -1) {
		names = append(names, match[1])
	}
	if missing := unread(t, names); len(missing) > 0 {
		t.Errorf("README documents variables nothing reads: %s", strings.Join(missing, ", "))
	}
}
