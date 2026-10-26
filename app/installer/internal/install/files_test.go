package install

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
)

func TestApplyWritesAWorkingInstallation(t *testing.T) {
	m := loadManifest(t)
	dir := t.TempDir()
	cfg := Defaults(dir)
	cfg.Access, cfg.Domain = AccessCloudflare, "music.example.com"

	if err := Apply(m, cfg, nil); err != nil {
		t.Fatal(err)
	}

	for _, action := range Plan(cfg) {
		if _, err := os.Stat(action.Path); err != nil {
			t.Errorf("%s: %v", action.Description, err)
		}
	}
	env, err := envfile.Read(EnvPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := env.Get("MUSIC_DIR"); got != cfg.MusicDir {
		t.Errorf("MUSIC_DIR = %q", got)
	}
	info, _ := os.Stat(EnvPath(dir))
	if info.Mode().Perm() != 0o600 {
		t.Errorf(".env mode %v, want 0600", info.Mode().Perm())
	}
	static, _ := os.ReadFile(filepath.Join(cfg.DataDir, "traefik", "traefik.yml"))
	if !strings.Contains(string(static), "email: admin@music.example.com") {
		t.Error("cloudflare mode must configure Let's Encrypt")
	}
	acme, _ := os.Stat(filepath.Join(cfg.DataDir, "traefik", "acme.json"))
	if acme.Mode().Perm() != 0o600 {
		t.Errorf("acme.json mode %v, want 0600", acme.Mode().Perm())
	}
}

func TestReapplyKeepsSecretsAndManualEdits(t *testing.T) {
	m := loadManifest(t)
	dir := t.TempDir()
	cfg := Defaults(dir)
	if err := Apply(m, cfg, nil); err != nil {
		t.Fatal(err)
	}
	first, _ := envfile.Read(EnvPath(dir))
	jwt, _ := first.Get("JWT_SECRET")
	data, _ := os.ReadFile(EnvPath(dir))
	os.WriteFile(EnvPath(dir), append(data, []byte("MY_TWEAK=\"on\"\n")...), 0o600)

	existing, err := ReadExisting(dir)
	if err != nil {
		t.Fatal(err)
	}
	cfg.Timezone = "Europe/Madrid"
	if err := Apply(m, cfg, existing); err != nil {
		t.Fatal(err)
	}

	second, _ := envfile.Read(EnvPath(dir))
	if got, _ := second.Get("JWT_SECRET"); got != jwt {
		t.Error("reapplying rotated JWT_SECRET")
	}
	if got, _ := second.Get("MY_TWEAK"); got != "on" {
		t.Error("reapplying dropped a manual setting")
	}
	if got, _ := second.Get("TZ"); got != "Europe/Madrid" {
		t.Errorf("TZ = %q", got)
	}
}

func TestPortsModeTraefikHasNoCertificates(t *testing.T) {
	if strings.Contains(TraefikStatic(Defaults("/srv/crate")), "certificatesResolvers") {
		t.Error("ports mode must not request certificates")
	}
}
