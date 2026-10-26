// Package copilot is `crate mcp`: an MCP server that lets an AI agent
// install and configure Crate by talking to the user. Secrets never pass
// through the agent: the user types them into a one-time page served on
// 127.0.0.1, and tools only report whether each one was accepted.
package copilot

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/system"
	"github.com/thecrateapp/crate/app/installer/internal/validate"
)

// Deps are the outside world; tests replace them.
type Deps struct {
	Run          system.Runner
	Validate     validate.Client
	HTTP         *http.Client
	DetectDocker func(context.Context, system.Runner, system.Host) (system.Docker, system.DockerState)
	Getenv       func(string) string
}

// Session is one installation being prepared. All tools share it.
type Session struct {
	mu       sync.Mutex
	deps     Deps
	manifest *manifest.Manifest

	dir      string
	cfg      install.Config
	existing *envfile.Values
	host     system.Host
	hostSeen bool

	checks      map[string]validate.Result // last result per integration id, plus "cloudflare"
	adminChosen bool                       // the user typed the admin password in the portal
	applied     bool                       // the files on disk match the session
	answered    map[string]bool            // basics, access, integrations: topics settled with the user
	job         *job
	portal      *portal
}

func NewSession(m *manifest.Manifest, deps Deps) *Session {
	return &Session{deps: deps, manifest: m, checks: map[string]validate.Result{}}
}

func defaultDir(getenv func(string) string) string {
	if dir := getenv("CRATE_INSTALL_DIR"); dir != "" {
		return dir
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, "crate")
	}
	return "crate"
}

func absolute(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "~" || strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		path = filepath.Join(home, strings.TrimPrefix(path, "~"))
	}
	return filepath.Abs(path)
}

// use loads dir the first time, or when the agent switches folders.
// Callers hold s.mu.
func (s *Session) use(ctx context.Context, dir string) error {
	if dir == "" {
		if s.dir != "" {
			return nil
		}
		dir = defaultDir(s.deps.Getenv)
	}
	path, err := absolute(dir)
	if err != nil {
		return err
	}
	if path == s.dir {
		return nil
	}
	if !s.hostSeen {
		s.host = system.DetectHost(ctx, s.deps.Run)
		s.hostSeen = true
	}
	existing, err := install.ReadExisting(path)
	if err != nil {
		return err
	}
	cfg := install.Defaults(path)
	cfg.Timezone, cfg.PUID, cfg.PGID = s.host.Timezone, s.host.UID, s.host.GID
	if existing != nil {
		cfg = install.FromEnvFile(cfg, existing)
	}
	s.dir, s.cfg, s.existing = path, cfg, existing
	s.checks = map[string]validate.Result{}
	s.adminChosen, s.applied = false, existing != nil
	s.answered = map[string]bool{}
	return nil
}

func (s *Session) draft() install.Draft {
	return install.Draft{Config: &s.cfg, Existing: s.existing}
}

func (s *Session) changed() { s.applied = false }

// check validates one integration with the session's values and keeps the result.
func (s *Session) check(ctx context.Context, in manifest.Integration) validate.Result {
	result := s.deps.Validate.Check(ctx, in.ID, s.draft().Values(in))
	s.checks[in.ID] = result
	return result
}

func (s *Session) docker(ctx context.Context) (system.Docker, system.DockerState) {
	return s.deps.DetectDocker(ctx, s.deps.Run, s.host)
}
