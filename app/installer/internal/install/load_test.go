package install

import (
	"testing"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
)

func TestFromEnvFilePrefillsAPreviousInstall(t *testing.T) {
	values := envfile.New()
	values.Set("MUSIC_DIR", "/mnt/music")
	values.Set("CRATE_ACCESS_MODE", "cloudflare")
	values.Set("DOMAIN", "music.example.com")
	values.Set("CRATE_API_PORT", "9585")
	values.Set("TZ", "")

	cfg := FromEnvFile(Defaults("/srv/crate"), values)

	if cfg.MusicDir != "/mnt/music" || cfg.Access != AccessCloudflare || cfg.Domain != "music.example.com" {
		t.Fatalf("got %+v", cfg)
	}
	if cfg.Ports.API != 9585 || cfg.Ports.Admin != 8580 {
		t.Fatalf("ports %+v", cfg.Ports)
	}
	if cfg.Timezone != "UTC" {
		t.Fatalf("an empty value must keep the default, got %q", cfg.Timezone)
	}
}

func TestWithOverridesAcceptsInstallShVariables(t *testing.T) {
	env := map[string]string{
		"CRATE_ACCESS_MODE":      "dns",
		"CRATE_MUSIC_DIR":        "/mnt/music",
		"DEFAULT_ADMIN_PASSWORD": "a-long-password",
	}

	cfg, err := WithOverrides(Defaults("/srv/crate"), func(key string) string { return env[key] })

	if err != nil {
		t.Fatal(err)
	}
	if cfg.Access != AccessDNSMasq || cfg.Domain != LocalDomainDefault || cfg.MusicDir != "/mnt/music" || cfg.AdminPassword != "a-long-password" {
		t.Fatalf("got %+v", cfg)
	}
	if _, err := WithOverrides(Defaults("/srv/crate"), func(key string) string {
		if key == "CRATE_ACCESS_MODE" {
			return "vpn"
		}
		return ""
	}); err == nil {
		t.Fatal("an unknown access mode must fail")
	}
}
