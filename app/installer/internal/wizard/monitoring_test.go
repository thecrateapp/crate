package wizard

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/monitoring"
	"github.com/thecrateapp/crate/app/installer/internal/system"
)

const activeOverlays = "docker-compose.yaml:deploy/observability/compose.projector-prometheus.yaml:" +
	"deploy/observability/compose.traefik-metrics.yaml:deploy/observability/compose.app-metrics.yaml"

func linuxWizard(t *testing.T, opts Options) (*wizard, *fakeRunner) {
	t.Helper()
	w, _, runner := newTestWizard(t, opts)
	w.detectHost = func(context.Context, system.Runner) system.Host {
		return system.Host{OS: "linux", Distro: "debian", Arch: "amd64", MemoryGB: 16, UID: "1000", GID: "1000", Timezone: "UTC"}
	}
	runner.outputs = map[string]string{
		"info --format":   "overlay2|/run/containerd/containerd.sock|/var/lib/docker|[name=seccomp]",
		"version --short": "2.29.1",
	}
	return w, runner
}

func prepared(t *testing.T, w *wizard, existing *envfile.Values) {
	t.Helper()
	w.host = w.detectHost(context.Background(), w.run)
	w.docker = system.Docker{Docker: []string{"docker"}, Compose: []string{"docker", "compose"}}
	w.cfg = install.Defaults(w.opts.InstallDir)
	w.existing = existing
}

func TestMonitoringStepFollowsTheUnattendedMode(t *testing.T) {
	active := envfile.New()
	active.Set("COMPOSE_FILE", activeOverlays)
	cases := []struct {
		name     string
		mode     string
		existing *envfile.Values
		want     bool
		summary  string
	}{
		{"new install defaults to off", "", nil, false, "off"},
		{"keep leaves it off", ObservabilityKeep, nil, false, "off"},
		{"keep leaves it on", ObservabilityKeep, active, true, "on · "},
		{"on", ObservabilityOn, nil, true, "on · "},
		{"off turns it off", ObservabilityOff, active, false, "turn off; data kept"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w, _ := linuxWizard(t, Options{Version: "v3.2.0", InstallDir: t.TempDir(), Yes: true, Observability: tc.mode})
			prepared(t, w, tc.existing)

			if err := w.monitoringStep(context.Background()); err != nil {
				t.Fatal(err)
			}

			if w.mon.want != tc.want || !strings.HasPrefix(w.monitoringSummary(), tc.summary) {
				t.Fatalf("want %v, summary %q", w.mon.want, w.monitoringSummary())
			}
		})
	}
}

func TestMonitoringStepTakesItsSettingsFromTheEnvironment(t *testing.T) {
	t.Setenv("CRATE_OBSERVABILITY_DIR", "/srv/monitoring")
	t.Setenv("CRATE_GRAFANA_PORT", "3301")
	t.Setenv("CRATE_GRAFANA_PASSWORD", "a-strong-grafana-password")
	w, _ := linuxWizard(t, Options{Version: "v3.2.0", InstallDir: t.TempDir(), Yes: true, Observability: ObservabilityOn})
	prepared(t, w, nil)

	if err := w.monitoringStep(context.Background()); err != nil {
		t.Fatal(err)
	}

	if got := w.monitoringSummary(); got != "on · /srv/monitoring · Grafana http://localhost:3301" {
		t.Fatalf("summary %q", got)
	}
	if w.monitor().Getenv("CRATE_GRAFANA_PASSWORD") != "a-strong-grafana-password" {
		t.Fatal("the password must reach the monitor only through its environment")
	}
}

func TestMonitoringStepRejectsAShortPassword(t *testing.T) {
	t.Setenv("CRATE_GRAFANA_PASSWORD", "short")
	w, _ := linuxWizard(t, Options{Version: "v3.2.0", InstallDir: t.TempDir(), Yes: true, Observability: ObservabilityOn})
	prepared(t, w, nil)

	if err := w.monitoringStep(context.Background()); err == nil || !strings.Contains(err.Error(), "12 characters") {
		t.Fatalf("got %v", err)
	}
}

func TestMonitoringIsNotAvailableOnMacOS(t *testing.T) {
	cases := []struct {
		mode string
		fail bool
	}{{ObservabilityKeep, false}, {ObservabilityOn, true}}
	for _, tc := range cases {
		t.Run(tc.mode, func(t *testing.T) {
			w, out, runner := newTestWizard(t, Options{Version: "v3.2.0", InstallDir: t.TempDir(), Yes: true, Observability: tc.mode})
			w.detectHost = func(context.Context, system.Runner) system.Host { return system.Host{OS: "darwin"} }
			prepared(t, w, nil)

			err := w.monitoringStep(context.Background())

			if (err != nil) != tc.fail || (err != nil && !strings.Contains(err.Error(), "needs Linux")) {
				t.Fatalf("got %v", err)
			}
			if !strings.Contains(out.String(), "not available") || w.monitoringSummary() != "not available" {
				t.Fatalf("output %q, summary %q", out.String(), w.monitoringSummary())
			}
			if len(runner.streamed) != 0 {
				t.Fatalf("commands ran: %v", runner.streamed)
			}
		})
	}
}

func TestMonitoringFromANewerInstallerIsLeftAlone(t *testing.T) {
	dir := t.TempDir()
	stored := envfile.New()
	stored.Set("OBS_RELEASE", "v9.0.0")
	if err := envfile.Write(filepath.Join(dir, monitoring.EnvName), envfile.Render(stored, "", nil)); err != nil {
		t.Fatal(err)
	}
	w, _ := linuxWizard(t, Options{Version: "v3.2.0", InstallDir: dir, Yes: true, Observability: ObservabilityOff})
	prepared(t, w, nil)

	if err := w.monitoringStep(context.Background()); err != nil {
		t.Fatal(err)
	}
	w.beforeApply()

	if !w.cfg.KeepMonitoringFiles || w.monitoringSummary() != "unchanged (set up by a newer installer)" {
		t.Fatalf("keep files %v, summary %q", w.cfg.KeepMonitoringFiles, w.monitoringSummary())
	}
	if err := w.applyMonitoring(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestDryRunShowsTheMonitoringPlanAndWritesNothing(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "crate")
	w, _ := linuxWizard(t, Options{Version: "v3.2.0", InstallDir: dir, Yes: true, DryRun: true, Observability: ObservabilityOn})
	var out strings.Builder
	w.out = &out

	if err := w.execute(context.Background()); err != nil {
		t.Fatalf("%v\n%s", err, out.String())
	}

	if !strings.Contains(out.String(), "Grafana http://localhost:3001") {
		t.Fatalf("the plan must show monitoring:\n%s", out.String())
	}
	if _, err := os.Stat(dir); err == nil {
		t.Fatal("a dry run wrote the installation")
	}
}

func TestUnattendedInstallWithoutStartingPointsAtTheMonitoringCommand(t *testing.T) {
	dir := t.TempDir()
	w, _ := linuxWizard(t, Options{Version: "v3.2.0", InstallDir: dir, Yes: true, SkipStart: true, Observability: ObservabilityOn})
	var out strings.Builder
	w.out = &out

	if err := w.execute(context.Background()); err != nil {
		t.Fatalf("%v\n%s", err, out.String())
	}

	if !strings.Contains(out.String(), "crate observability enable") {
		t.Fatalf("output:\n%s", out.String())
	}
	if _, err := os.Stat(filepath.Join(dir, monitoring.EnvName)); err == nil {
		t.Fatal("monitoring was set up without starting Crate")
	}
	if _, err := os.Stat(filepath.Join(dir, "deploy", "observability", "compose.standalone.yaml")); err != nil {
		t.Fatal("the monitoring files are written with the installation")
	}
}
