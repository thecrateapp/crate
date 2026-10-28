package agent

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
)

func settings(pairs ...string) *envfile.Values {
	values := envfile.New()
	for i := 0; i+1 < len(pairs); i += 2 {
		values.Set(pairs[i], pairs[i+1])
	}
	return values
}

func TestActivateSetsTheProfileAndTheOverlay(t *testing.T) {
	overlay := "docker-compose.yaml:deploy/operator/compose.operator.yaml"
	cases := []struct {
		name               string
		profiles, files    string
		to                 Mode
		wantProfiles, want string
	}{
		{"agent on", "soulseek", "", Agent, "soulseek,agent", ""},
		{"operator on", "soulseek,agent", "", Operator, "soulseek,crate-operator", overlay},
		{"back to agent", "crate-operator", overlay, Agent, "agent", ""},
		{"off", "crate-operator,soulseek", overlay, Off, "soulseek", ""},
		{"operator twice", "crate-operator", overlay, Operator, "crate-operator", overlay},
		{"keeps other files", "", "docker-compose.yaml:mine.yaml", Operator, "crate-operator", "docker-compose.yaml:mine.yaml:deploy/operator/compose.operator.yaml"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			values := settings("COMPOSE_PROFILES", tc.profiles)
			if tc.files != "" {
				values.Set("COMPOSE_FILE", tc.files)
			}
			Activate(values, tc.to)
			profiles, _ := values.Get("COMPOSE_PROFILES")
			files, _ := values.Get("COMPOSE_FILE")
			if profiles != tc.wantProfiles || files != tc.want {
				t.Fatalf("profiles %q files %q", profiles, files)
			}
			if Active(values) != tc.to {
				t.Fatalf("active %q", Active(values))
			}
		})
	}
}

func TestWantedReadsTheMode(t *testing.T) {
	cases := map[string]Mode{"": Off, "agent": Agent, " Operator ": Operator, "telegram": Off}
	for value, want := range cases {
		if got := Wanted(settings("CRATE_AGENT_MODE", value)); got != want {
			t.Errorf("%q: got %q", value, got)
		}
	}
	if _, ok := ParseMode("bot"); ok {
		t.Error("unknown modes are refused")
	}
}

func TestLayoutsAndStoredSecrets(t *testing.T) {
	data := t.TempDir()
	values := settings("DATA_DIR", data)
	cases := []struct {
		mode    Mode
		values  *envfile.Values
		secrets string
	}{
		{Agent, values, filepath.Join(data, "crate-agent", "secrets")},
		{Operator, values, filepath.Join(data, "crate-operator", "secrets", "domain")},
		{Operator, settings("DATA_DIR", data, "CRATE_OPERATOR_ROOT", "/opt/op"), "/opt/op/secrets/domain"},
	}
	for _, tc := range cases {
		if got := LayoutOf(tc.values, tc.mode).Secrets; got != tc.secrets {
			t.Errorf("%s: %s", tc.mode, got)
		}
	}
	secrets := LayoutOf(values, Agent).Secrets
	os.MkdirAll(filepath.Join(secrets, "model-keys"), 0o700)
	os.WriteFile(filepath.Join(secrets, "telegram-token"), []byte("123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n"), 0o600)
	os.WriteFile(filepath.Join(secrets, "allowed-users"), []byte("@me"), 0o600)
	os.WriteFile(filepath.Join(secrets, "model-keys", "anthropic"), []byte("sk-ant-0123456789"), 0o600)
	stored := StoredSecrets(values, Agent)
	if !stored.Bot || stored.Users || !stored.Key("anthropic") || stored.Key("gemini") {
		t.Fatalf("stored %+v", stored)
	}
	if other := StoredSecrets(values, Operator); other.Bot || other.Key("anthropic") {
		t.Fatal("each mode has its own secrets")
	}
}
