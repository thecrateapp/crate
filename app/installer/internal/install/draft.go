package install

import (
	"slices"
	"strings"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/secrets"
)

// BundledSlskdURL is how Crate reaches the slskd of the soulseek profile.
const BundledSlskdURL = "http://slskd:5030"

// Draft is an installation being edited: the answers so far on top of the
// existing .env. The wizard and the MCP server both change installs through it.
type Draft struct {
	Config   *Config
	Existing *envfile.Values
}

// Value is what .env will hold for env.
func (d Draft) Value(env string) string {
	if value, ok := d.Config.Integrations[env]; ok {
		return value
	}
	if d.Existing != nil {
		value, _ := d.Existing.Get(env)
		return value
	}
	return ""
}

func (d Draft) Set(env, value string) {
	if d.Config.Integrations == nil {
		d.Config.Integrations = map[string]string{}
	}
	d.Config.Integrations[env] = strings.TrimSpace(value)
}

func (d Draft) Enabled(in manifest.Integration) bool {
	return IntegrationEnabled(in, d.Value)
}

func (d Draft) Values(in manifest.Integration) map[string]string {
	values := map[string]string{}
	for _, env := range in.Env {
		values[env.Name] = d.Value(env.Name)
	}
	return values
}

// Clear turns an integration off.
func (d Draft) Clear(in manifest.Integration) {
	for _, env := range in.Env {
		d.Set(env.Name, "")
	}
	if in.ID == "soulseek" {
		d.SetProfile("soulseek", false)
	}
}

func (d Draft) SetProfile(profile string, on bool) {
	if d.Config.Profiles == nil {
		d.Config.Profiles = []string{}
		for _, existing := range strings.Split(d.Value("COMPOSE_PROFILES"), ",") {
			if existing = strings.TrimSpace(existing); existing != "" {
				d.Config.Profiles = append(d.Config.Profiles, existing)
			}
		}
	}
	d.Config.Profiles = slices.DeleteFunc(d.Config.Profiles, func(p string) bool { return p == profile })
	if on {
		d.Config.Profiles = append(d.Config.Profiles, profile)
	}
}

// UseBundledSlskd points Crate at the slskd it runs itself, with a fresh API
// key unless one was already generated for it.
func (d Draft) UseBundledSlskd() error {
	if d.Value("SLSKD_API_KEY") == "" || d.Value("SLSKD_URL") != BundledSlskdURL {
		key, err := secrets.Generate("hex32")
		if err != nil {
			return err
		}
		d.Set("SLSKD_API_KEY", key)
	}
	d.Set("SLSKD_URL", BundledSlskdURL)
	d.SetProfile("soulseek", true)
	return nil
}

// UseExternalSlskd stops running Crate's slskd and forgets its account.
func (d Draft) UseExternalSlskd() {
	d.SetProfile("soulseek", false)
	d.Set("SLSKD_SLSK_USERNAME", "")
	d.Set("SLSKD_SLSK_PASSWORD", "")
}

// EnableMCP turns the agent endpoint on. OAuth needs a public HTTPS origin,
// so it is enabled only with Cloudflare access.
func (d Draft) EnableMCP(actions bool) {
	d.Set("CRATE_MCP_ENABLED", "true")
	if actions {
		d.Set("CRATE_MCP_ACTIONS_ENABLED", "true")
	} else {
		d.Set("CRATE_MCP_ACTIONS_ENABLED", "false")
	}
	if d.Config.Access == AccessCloudflare {
		d.Set("CRATE_MCP_OAUTH_ENABLED", "true")
		d.Set("CRATE_MCP_OAUTH_ISSUER", d.Config.PublicURLs().API)
		return
	}
	d.Set("CRATE_MCP_OAUTH_ENABLED", "false")
	d.Set("CRATE_MCP_OAUTH_ISSUER", "")
}
