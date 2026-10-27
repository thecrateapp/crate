package install

import (
	"strings"
	"testing"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
)

func loadManifest(t *testing.T) *manifest.Manifest {
	t.Helper()
	m, err := manifest.Load()
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func TestBuildEnvGeneratesEverySecret(t *testing.T) {
	m := loadManifest(t)
	values, err := BuildEnv(m, Defaults("/srv/crate"), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, g := range m.Generated {
		value, _ := values.Get(g.Env)
		if value == "" {
			t.Errorf("%s was not generated", g.Env)
		}
	}
	for _, key := range []string{"REDIS_PASSWORD", "CRATE_READPLANE_SERVICE_TOKEN"} {
		if value, ok := values.Get(key); !ok || value == "" {
			t.Errorf("required readplane secret %s was not generated", key)
		}
	}
	postgres, _ := values.Get("CRATE_POSTGRES_PASSWORD")
	superuser, _ := values.Get("POSTGRES_SUPERUSER_PASSWORD")
	if postgres != superuser {
		t.Error("the superuser password must match the Crate database password")
	}
}

func TestBuildEnvKeepsExistingSecretsAndUserSettings(t *testing.T) {
	m := loadManifest(t)
	existing := envfile.New()
	existing.Set("JWT_SECRET", "kept-jwt")
	existing.Set("CRATE_POSTGRES_PASSWORD", "kept-db")
	existing.Set("LASTFM_APIKEY", "kept-key")
	existing.Set("MY_TWEAK", "1")

	values, err := BuildEnv(m, Defaults("/srv/crate"), existing)
	if err != nil {
		t.Fatal(err)
	}

	for key, want := range map[string]string{
		"JWT_SECRET":                  "kept-jwt",
		"CRATE_POSTGRES_PASSWORD":     "kept-db",
		"POSTGRES_SUPERUSER_PASSWORD": "kept-db",
		"LASTFM_APIKEY":               "kept-key",
		"MY_TWEAK":                    "1",
	} {
		if got, _ := values.Get(key); got != want {
			t.Errorf("%s = %q, want %q", key, got, want)
		}
	}
	if key, _ := values.Get("CRATE_CREDENTIAL_KEY"); key == "" {
		t.Error("an existing install must gain the missing credential key")
	}
}

func TestAccessModesSetTraefikAndPublicURLs(t *testing.T) {
	m := loadManifest(t)
	cases := []struct {
		access AccessMode
		domain string
		tls    string
		api    string
	}{
		{AccessPorts, "localhost", "false", "http://localhost:8585"},
		{AccessHosts, "crate.local", "false", "http://api.crate.local"},
		{AccessDNSMasq, "crate.lan", "false", "http://api.crate.lan"},
		{AccessCloudflare, "music.example.com", "true", "https://api.music.example.com"},
	}
	for _, tc := range cases {
		t.Run(string(tc.access), func(t *testing.T) {
			cfg := Defaults("/srv/crate")
			cfg.Access, cfg.Domain = tc.access, tc.domain
			values, err := BuildEnv(m, cfg, nil)
			if err != nil {
				t.Fatal(err)
			}
			if got, _ := values.Get("TRAEFIK_TLS_ENABLED"); got != tc.tls {
				t.Errorf("TLS = %q, want %q", got, tc.tls)
			}
			if got, _ := values.Get("CRATE_PUBLIC_API_BASE_URL"); got != tc.api {
				t.Errorf("API URL = %q, want %q", got, tc.api)
			}
		})
	}
}

func TestParseAccessModeAcceptsInstallShAliases(t *testing.T) {
	for alias, want := range map[string]AccessMode{"cf": AccessCloudflare, "dns": AccessDNSMasq, "host": AccessHosts, "": AccessPorts} {
		got, err := ParseAccessMode(alias)
		if err != nil || got != want {
			t.Errorf("%q: got %q, %v", alias, got, err)
		}
	}
	if _, err := ParseAccessMode("vpn"); err == nil {
		t.Error("expected an error for an unknown mode")
	}
}

func TestValidateDomain(t *testing.T) {
	for _, ok := range []string{"localhost", "crate.local", "music.example.com"} {
		if err := ValidateDomain(ok); err != nil {
			t.Errorf("%s: %v", ok, err)
		}
	}
	for _, bad := range []string{"crate", "-bad.com", "http://x.com", "192.168.1.10"} {
		if err := ValidateDomain(bad); err == nil {
			t.Errorf("%s should be rejected", bad)
		}
	}
}

func TestSectionsCoverEveryManifestVariable(t *testing.T) {
	m := loadManifest(t)
	covered := map[string]bool{}
	for _, s := range Sections(m) {
		for _, key := range s.Keys {
			covered[key] = true
		}
	}
	var missing []string
	for _, name := range m.Variables() {
		if !covered[name] {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		t.Errorf("variables outside any section: %s", strings.Join(missing, ", "))
	}
}

func TestReconfiguringKeepsSettingsTheWizardDoesNotAsk(t *testing.T) {
	m := loadManifest(t)
	existing := envfile.New()
	existing.Set("CRATE_ACCESS_MODE", "ports")
	existing.Set("DOMAIN", "localhost")
	existing.Set("CRATE_IMAGE_OWNER", "my-fork")
	existing.Set("CRATE_LISTEN_PUBLIC_BASE_URL", "http://192.168.1.20:8581")

	values, err := BuildEnv(m, Defaults("/srv/crate"), existing)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := values.Get("CRATE_IMAGE_OWNER"); got != "my-fork" {
		t.Errorf("CRATE_IMAGE_OWNER = %q", got)
	}
	if got, _ := values.Get("CRATE_LISTEN_PUBLIC_BASE_URL"); got != "http://192.168.1.20:8581" {
		t.Errorf("a hand-set Listen URL was replaced: %q", got)
	}

	moved := Defaults("/srv/crate")
	moved.Access, moved.Domain = AccessCloudflare, "music.example.com"
	values, _ = BuildEnv(m, moved, existing)
	if got, _ := values.Get("CRATE_LISTEN_PUBLIC_BASE_URL"); got != "https://listen.music.example.com" {
		t.Errorf("changing the access mode must move the public URLs, got %q", got)
	}
}

func TestBuildEnvNeverWritesTransientValues(t *testing.T) {
	m := loadManifest(t)
	cfg := Defaults("/srv/crate")
	cfg.Integrations = map[string]string{
		"CRATE_AGENT_MODE":     "agent",
		"AGENT_TELEGRAM_TOKEN": "123:secret",
		"AGENT_MODEL_API_KEY":  "sk-secret",
	}
	values, err := BuildEnv(m, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := values.Get("CRATE_AGENT_MODE"); got != "agent" {
		t.Errorf("CRATE_AGENT_MODE = %q", got)
	}
	for name := range m.Transient() {
		if _, ok := values.Get(name); ok {
			t.Errorf("%s reached .env", name)
		}
	}
}
