// Package manifest loads deploy/install/integrations.yaml, the declaration of
// every setting the installer writes and every optional integration.
package manifest

import (
	"fmt"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/thecrateapp/crate/app/installer/internal/assets"
)

type Setting struct {
	Env           string `yaml:"env"`
	Label         string `yaml:"label"`
	Secret        bool   `yaml:"secret"`
	InstallerOnly bool   `yaml:"installer_only"`
}

type Generated struct {
	Env    string `yaml:"env"`
	Format string `yaml:"format"`
}

type IntegrationEnv struct {
	Name          string `yaml:"name"`
	Label         string `yaml:"label"`
	Secret        bool   `yaml:"secret"`
	Default       string `yaml:"default"`
	Placeholder   string `yaml:"placeholder"`
	InstallerOnly bool   `yaml:"installer_only"`
	Transient     bool   `yaml:"transient"`
}

type KeyGuide struct {
	URL   string   `yaml:"url"`
	Steps []string `yaml:"steps"`
}

type Integration struct {
	ID          string           `yaml:"id"`
	Group       string           `yaml:"group"`
	Title       string           `yaml:"title"`
	Tagline     string           `yaml:"tagline"`
	Summary     string           `yaml:"summary"`
	Recommended bool             `yaml:"recommended"`
	Env         []IntegrationEnv `yaml:"env"`
	GetKey      KeyGuide         `yaml:"get_key"`
	Validate    string           `yaml:"validate"`
}

type Manifest struct {
	Version      int           `yaml:"version"`
	Core         []Setting     `yaml:"core"`
	Generated    []Generated   `yaml:"generated"`
	Tuning       []string      `yaml:"tuning"`
	Integrations []Integration `yaml:"integrations"`
}

var generatedFormats = map[string]bool{"hex16": true, "hex32": true, "fernet": true}

// Load parses the manifest embedded in this installer build.
func Load() (*Manifest, error) {
	data, err := assets.Read(assets.Manifest)
	if err != nil {
		return nil, err
	}
	return Parse(data)
}

func Parse(data []byte) (*Manifest, error) {
	var m Manifest
	if err := yaml.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("parse manifest: %w", err)
	}
	if err := m.validate(); err != nil {
		return nil, err
	}
	return &m, nil
}

func (m *Manifest) validate() error {
	if m.Version != 1 {
		return fmt.Errorf("unsupported manifest version %d", m.Version)
	}
	seen := map[string]string{}
	claim := func(env, owner string) error {
		if env == "" {
			return fmt.Errorf("%s declares an empty variable name", owner)
		}
		if previous, ok := seen[env]; ok {
			return fmt.Errorf("%s is declared by both %s and %s", env, previous, owner)
		}
		seen[env] = owner
		return nil
	}
	for _, s := range m.Core {
		if err := claim(s.Env, "core"); err != nil {
			return err
		}
	}
	for _, g := range m.Generated {
		if err := claim(g.Env, "generated"); err != nil {
			return err
		}
		if source, ok := strings.CutPrefix(g.Format, "same:"); ok {
			if _, declared := seen[source]; !declared {
				return fmt.Errorf("%s copies %s, which must be declared before it", g.Env, source)
			}
			continue
		}
		if !generatedFormats[g.Format] {
			return fmt.Errorf("%s has unknown format %q", g.Env, g.Format)
		}
	}
	for _, name := range m.Tuning {
		if err := claim(name, "tuning"); err != nil {
			return err
		}
	}
	ids := map[string]bool{}
	for _, in := range m.Integrations {
		if in.ID == "" || ids[in.ID] {
			return fmt.Errorf("integration id %q is empty or repeated", in.ID)
		}
		if len(in.Tagline) > 40 {
			return fmt.Errorf("integration %s: keep the tagline under 40 characters", in.ID)
		}
		ids[in.ID] = true
		for _, e := range in.Env {
			if err := claim(e.Name, "integration "+in.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

// Variables returns every variable the manifest declares, sorted.
func (m *Manifest) Variables() []string {
	var names []string
	for _, s := range m.Core {
		names = append(names, s.Env)
	}
	for _, g := range m.Generated {
		names = append(names, g.Env)
	}
	names = append(names, m.Tuning...)
	for _, in := range m.Integrations {
		for _, e := range in.Env {
			names = append(names, e.Name)
		}
	}
	sort.Strings(names)
	return names
}

// InstallerOnly reports variables no container reads: the ones the
// installer keeps for itself and the transient ones.
func (m *Manifest) InstallerOnly() map[string]bool {
	only := map[string]bool{}
	for _, s := range m.Core {
		if s.InstallerOnly {
			only[s.Env] = true
		}
	}
	for _, in := range m.Integrations {
		for _, e := range in.Env {
			if e.InstallerOnly || e.Transient {
				only[e.Name] = true
			}
		}
	}
	return only
}

// Transient reports integration variables that are never written to .env.
func (m *Manifest) Transient() map[string]bool {
	transient := map[string]bool{}
	for _, in := range m.Integrations {
		for _, e := range in.Env {
			if e.Transient {
				transient[e.Name] = true
			}
		}
	}
	return transient
}

// Secret reports whether a variable holds a credential that must never be shown.
func (m *Manifest) Secret(env string) bool {
	for _, s := range m.Core {
		if s.Env == env {
			return s.Secret
		}
	}
	for _, g := range m.Generated {
		if g.Env == env {
			return true
		}
	}
	for _, in := range m.Integrations {
		for _, e := range in.Env {
			if e.Name == env {
				return e.Secret
			}
		}
	}
	return false
}

func (m *Manifest) Integration(id string) (Integration, bool) {
	for _, in := range m.Integrations {
		if in.ID == id {
			return in, true
		}
	}
	return Integration{}, false
}
