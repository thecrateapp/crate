package install

import (
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
)

// IntegrationEnabled reports whether an integration has been set up: one
// of its variables without a default holds a value other than "false".
func IntegrationEnabled(in manifest.Integration, get func(string) string) bool {
	for _, env := range in.Env {
		if env.Default != "" {
			continue
		}
		if value := get(env.Name); value != "" && value != "false" {
			return true
		}
	}
	return false
}

// IntegrationOverrides takes every integration variable present in the
// environment, so `crate install --yes` can be scripted with API keys.
func IntegrationOverrides(m *manifest.Manifest, cfg Config, getenv func(string) string) Config {
	for _, in := range m.Integrations {
		for _, env := range in.Env {
			if value := getenv(env.Name); value != "" {
				if cfg.Integrations == nil {
					cfg.Integrations = map[string]string{}
				}
				cfg.Integrations[env.Name] = value
			}
		}
	}
	return cfg
}
