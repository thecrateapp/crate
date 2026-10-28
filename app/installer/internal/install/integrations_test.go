package install

import (
	"testing"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
)

func TestIntegrationEnabled(t *testing.T) {
	m := loadManifest(t)
	soulseek, _ := m.Integration("soulseek")
	mcp, _ := m.Integration("mcp")
	values := map[string]string{"SLSKD_LISTEN_PORT": "50300", "CRATE_MCP_ENABLED": "false"}
	get := func(key string) string { return values[key] }

	if IntegrationEnabled(soulseek, get) {
		t.Error("a default port alone does not enable Soulseek")
	}
	if IntegrationEnabled(mcp, get) {
		t.Error("false does not enable MCP")
	}
	values["SLSKD_URL"] = "http://slskd:5030"
	values["CRATE_MCP_ENABLED"] = "true"
	if !IntegrationEnabled(soulseek, get) || !IntegrationEnabled(mcp, get) {
		t.Error("set values must enable the integrations")
	}
}

func TestBuildEnvWritesIntegrationsAndProfiles(t *testing.T) {
	m := loadManifest(t)
	existing := envfile.New()
	existing.Set("FANART_API_KEY", "old")
	existing.Set("COMPOSE_PROFILES", "soulseek")
	cfg := Defaults("/srv/crate")
	cfg.Integrations = map[string]string{"LASTFM_APIKEY": "key", "FANART_API_KEY": ""}

	values, err := BuildEnv(m, cfg, existing)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := values.Get("LASTFM_APIKEY"); got != "key" {
		t.Errorf("LASTFM_APIKEY = %q", got)
	}
	if got, _ := values.Get("FANART_API_KEY"); got != "" {
		t.Errorf("a turned-off integration must be cleared, got %q", got)
	}
	if got, _ := values.Get("COMPOSE_PROFILES"); got != "soulseek" {
		t.Errorf("nil profiles must keep the existing ones, got %q", got)
	}

	cfg.Profiles = []string{}
	values, _ = BuildEnv(m, cfg, existing)
	if got, _ := values.Get("COMPOSE_PROFILES"); got != "" {
		t.Errorf("an empty list turns every profile off, got %q", got)
	}
}

func TestIntegrationOverridesReadTheEnvironment(t *testing.T) {
	m := loadManifest(t)
	env := map[string]string{"FANART_API_KEY": "from-env", "UNRELATED": "x"}
	cfg := IntegrationOverrides(m, Defaults("/srv/crate"), func(k string) string { return env[k] })
	if cfg.Integrations["FANART_API_KEY"] != "from-env" || len(cfg.Integrations) != 1 {
		t.Fatalf("got %v", cfg.Integrations)
	}
}
