package install

import (
	"strings"
	"testing"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
)

func TestDraftPrefersAnswersOverTheExistingFile(t *testing.T) {
	cfg := Defaults("/srv/crate")
	existing := envfile.New()
	existing.Set("FANART_API_KEY", "old")
	d := Draft{Config: &cfg, Existing: existing}

	if d.Value("FANART_API_KEY") != "old" {
		t.Fatal("the existing value must show through")
	}
	d.Set("FANART_API_KEY", " new ")
	if d.Value("FANART_API_KEY") != "new" {
		t.Fatal("answers win and are trimmed")
	}
}

func TestBundledSlskdKeepsItsKeyAndProfile(t *testing.T) {
	cfg := Defaults("/srv/crate")
	d := Draft{Config: &cfg}

	if err := d.UseBundledSlskd(); err != nil {
		t.Fatal(err)
	}
	key := d.Value("SLSKD_API_KEY")
	d.UseBundledSlskd()

	if key == "" || d.Value("SLSKD_API_KEY") != key {
		t.Fatal("the generated key must stay stable")
	}
	if strings.Join(cfg.Profiles, ",") != "soulseek" || d.Value("SLSKD_URL") != BundledSlskdURL {
		t.Fatalf("profiles %v url %q", cfg.Profiles, d.Value("SLSKD_URL"))
	}
	d.UseExternalSlskd()
	if len(cfg.Profiles) != 0 {
		t.Fatal("an external slskd turns the profile off")
	}
}

func TestEnableMCPUsesOAuthOnlyWithPublicHTTPS(t *testing.T) {
	cfg := Defaults("/srv/crate")
	d := Draft{Config: &cfg}
	d.EnableMCP(false)
	if d.Value("CRATE_MCP_OAUTH_ENABLED") != "false" || d.Value("CRATE_MCP_ACTIONS_ENABLED") != "false" {
		t.Fatal("ports mode has no OAuth")
	}
	cfg.Access, cfg.Domain = AccessCloudflare, "music.example.com"
	d.EnableMCP(true)
	if d.Value("CRATE_MCP_OAUTH_ISSUER") != "https://api.music.example.com" || d.Value("CRATE_MCP_ACTIONS_ENABLED") != "true" {
		t.Fatalf("issuer %q", d.Value("CRATE_MCP_OAUTH_ISSUER"))
	}
}
