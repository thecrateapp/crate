package manifest

import (
	"regexp"
	"strings"
	"testing"

	"github.com/thecrateapp/crate/app/installer/internal/assets"
)

var composeVariable = regexp.MustCompile(`\$\{([A-Z0-9_]+)`)

func TestTheEmbeddedManifestLoads(t *testing.T) {
	m, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Integrations) == 0 {
		t.Fatal("manifest declares no integrations")
	}
}

func TestManifestAndHomeComposeDeclareTheSameVariables(t *testing.T) {
	m, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	used := map[string]bool{}
	for _, name := range []string{assets.Compose, assets.OperatorOverlay} {
		compose, err := assets.Read(name)
		if err != nil {
			t.Fatal(err)
		}
		for _, match := range composeVariable.FindAllStringSubmatch(string(compose), -1) {
			used[match[1]] = true
		}
	}
	declared := map[string]bool{}
	for _, name := range m.Variables() {
		declared[name] = true
	}
	for name := range used {
		if !declared[name] {
			t.Errorf("the home compose or the operator overlay reads %s; declare it in deploy/install/integrations.yaml", name)
		}
	}
	installerOnly := m.InstallerOnly()
	for name := range declared {
		if !used[name] && !installerOnly[name] {
			t.Errorf("%s is declared in the manifest but neither the home compose nor the operator overlay reads it", name)
		}
	}
}

func TestParseRejectsBrokenManifests(t *testing.T) {
	cases := map[string]string{
		"unknown version": "version: 2",
		"duplicate variable": `version: 1
core:
  - env: TZ
tuning: [TZ]`,
		"unknown secret format": `version: 1
generated:
  - env: JWT_SECRET
    format: base32`,
		"copy of an undeclared secret": `version: 1
generated:
  - env: B
    format: same:A`,
		"repeated integration": `version: 1
integrations:
  - id: lastfm
  - id: lastfm`,
	}
	for name, doc := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Parse([]byte(doc)); err == nil {
				t.Fatalf("expected an error for %s", strings.TrimSpace(name))
			}
		})
	}
}

func TestTransientVariablesAreInstallerOnly(t *testing.T) {
	m, err := Parse([]byte(`version: 1
integrations:
  - id: agent
    env:
      - name: CRATE_AGENT_MODE
        installer_only: true
      - name: CRATE_AGENT_MODEL
      - name: AGENT_TELEGRAM_TOKEN
        secret: true
        transient: true`))
	if err != nil {
		t.Fatal(err)
	}
	only, transient := m.InstallerOnly(), m.Transient()
	cases := []struct {
		name                string
		installerOnly, temp bool
	}{
		{"CRATE_AGENT_MODE", true, false},
		{"CRATE_AGENT_MODEL", false, false},
		{"AGENT_TELEGRAM_TOKEN", true, true},
	}
	for _, tc := range cases {
		if only[tc.name] != tc.installerOnly || transient[tc.name] != tc.temp {
			t.Errorf("%s: installer only %v, transient %v", tc.name, only[tc.name], transient[tc.name])
		}
	}
	if !m.Secret("AGENT_TELEGRAM_TOKEN") {
		t.Error("a transient secret is still a secret")
	}
}

func composeVariables(t *testing.T, names ...string) map[string]bool {
	t.Helper()
	used := map[string]bool{}
	for _, name := range names {
		compose, err := assets.Read(assets.ObservabilityDir + "/" + name)
		if err != nil {
			t.Fatal(err)
		}
		for _, match := range composeVariable.FindAllStringSubmatch(string(compose), -1) {
			used[match[1]] = true
		}
	}
	return used
}

func TestMonitoringManifestMatchesTheMonitoringCompose(t *testing.T) {
	m, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	used := composeVariables(t,
		"compose.standalone.yaml", "compose.observability.yaml", "compose.containerd.yaml")
	declared := map[string]bool{}
	for _, s := range m.Monitoring.Env {
		declared[s.Env] = true
		if !used[s.Env] && !s.InstallerOnly {
			t.Errorf("monitoring declares %s but no monitoring compose file reads it", s.Env)
		}
	}
	for name := range used {
		if !declared[name] {
			t.Errorf("the monitoring compose reads %s; declare it under monitoring.env", name)
		}
	}
}

func TestMonitoringManifestMatchesTheApplicationOverlays(t *testing.T) {
	m, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	used := composeVariables(t,
		"compose.projector-prometheus.yaml", "compose.traefik-metrics.yaml",
		"compose.app-metrics.yaml", "compose.supervisor-prometheus.yaml")
	application := map[string]bool{}
	for _, name := range m.Variables() {
		application[name] = true
	}
	overlay := map[string]bool{}
	for _, s := range m.Monitoring.App {
		overlay[s.Env] = true
		if !used[s.Env] {
			t.Errorf("monitoring.app declares %s but no application overlay reads it", s.Env)
		}
	}
	for name := range used {
		if !overlay[name] && !application[name] {
			t.Errorf("an application overlay reads %s; declare it under monitoring.app", name)
		}
	}
}
