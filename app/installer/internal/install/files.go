package install

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/thecrateapp/crate/app/installer/internal/assets"
	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
)

func EnvPath(installDir string) string {
	return filepath.Join(installDir, ".env")
}

// ReadExisting returns the .env of a previous installation, or nil.
func ReadExisting(installDir string) (*envfile.Values, error) {
	values, err := envfile.Read(EnvPath(installDir))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return values, err
}

// ComposeFiles are the compose files of an installation: COMPOSE_FILE, or
// the stack alone.
func ComposeFiles(values *envfile.Values) []string {
	var files []string
	if values != nil {
		value, _ := values.Get("COMPOSE_FILE")
		for _, file := range strings.Split(value, ":") {
			if file = strings.TrimSpace(file); file != "" {
				files = append(files, file)
			}
		}
	}
	if len(files) == 0 {
		return []string{"docker-compose.yaml"}
	}
	return files
}

// Action is one change Apply makes, shown before anything is written.
type Action struct {
	Description string
	Path        string
}

// Plan lists what Apply will do without touching the disk.
func Plan(cfg Config) []Action {
	traefik := filepath.Join(cfg.DataDir, "traefik")
	return []Action{
		{"Create the music, data and downloads folders", cfg.MusicDir},
		{"Write the Crate compose stack", filepath.Join(cfg.InstallDir, "docker-compose.yaml")},
		{"Write Crate's configuration", filepath.Join(cfg.InstallDir, "config.yaml")},
		{"Write the read-plane routes for Traefik", filepath.Join(cfg.InstallDir, "deploy", "traefik", assets.FederationRoutes)},
		{"Write the Crate Agent setup", filepath.Join(cfg.InstallDir, "scripts", assets.AgentSetup)},
		{"Write Traefik's configuration", filepath.Join(traefik, "traefik.yml")},
		{"Write the settings and secrets (owner-only)", EnvPath(cfg.InstallDir)},
	}
}

// Apply writes every file of the installation.
func Apply(m *manifest.Manifest, cfg Config, existing *envfile.Values) error {
	traefik := filepath.Join(cfg.DataDir, "traefik")
	dirs := []string{
		cfg.InstallDir,
		cfg.MusicDir,
		cfg.DataDir,
		cfg.DownloadsDir,
		filepath.Join(traefik, "conf"),
		filepath.Join(traefik, "logs"),
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create %s: %w", dir, err)
		}
	}
	for name, relative := range assets.Deployed {
		data, err := assets.Read(name)
		if err != nil {
			return err
		}
		path := filepath.Join(cfg.InstallDir, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return fmt.Errorf("create %s: %w", filepath.Dir(path), err)
		}
		if err := os.WriteFile(path, data, 0o644); err != nil {
			return fmt.Errorf("write %s: %w", path, err)
		}
	}
	if err := os.WriteFile(filepath.Join(traefik, "traefik.yml"), []byte(TraefikStatic(cfg)), 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(traefik, "conf", "dynamic.yml"), []byte(TraefikDynamic), 0o644); err != nil {
		return err
	}
	acme := filepath.Join(traefik, "acme.json")
	if _, err := os.Stat(acme); errors.Is(err, os.ErrNotExist) {
		if err := os.WriteFile(acme, nil, 0o600); err != nil {
			return err
		}
	}
	values, err := BuildEnv(m, cfg, existing)
	if err != nil {
		return err
	}
	return envfile.Write(EnvPath(cfg.InstallDir), envfile.Render(values, EnvHeader, Sections(m)))
}
