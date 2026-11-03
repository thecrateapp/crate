package monitoring

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/system"
)

const (
	projector  = "deploy/observability/compose.projector-prometheus.yaml"
	traefik    = "deploy/observability/compose.traefik-metrics.yaml"
	appMetrics = "deploy/observability/compose.app-metrics.yaml"
	supervisor = "deploy/observability/compose.supervisor-prometheus.yaml"
	operator   = "deploy/operator/compose.operator.yaml"
)

type event struct {
	kind string
	line string
	env  []string
}

type fakeRunner struct {
	events      []event
	networks    bool
	grafanaSet  bool
	setupFailed string
}

func (f *fakeRunner) Output(_ context.Context, name string, args ...string) (string, error) {
	line := name + " " + strings.Join(args, " ")
	f.events = append(f.events, event{kind: "output", line: line})
	switch {
	case slices.Contains(args, "info"):
		return "overlay2|/run/containerd/containerd.sock|/var/lib/docker|[name=seccomp]", nil
	case slices.Contains(args, "version"):
		return "2.29.1", nil
	case slices.Contains(args, "inspect"):
		if f.networks {
			return "[]", nil
		}
		return "", errors.New("no such network")
	case slices.Contains(args, "ps"):
		return `{"Service":"crate-grafana","State":"running","Health":"healthy"}`, nil
	}
	return "", nil
}

func (f *fakeRunner) Stream(_ context.Context, _ io.Writer, _ string, name string, args ...string) error {
	f.events = append(f.events, event{kind: "stream", line: name + " " + strings.Join(args, " ")})
	return nil
}

func (f *fakeRunner) Run(_ context.Context, c system.Command) error {
	line := c.Name + " " + strings.Join(c.Args, " ")
	f.events = append(f.events, event{kind: "run", line: line, env: c.Env})
	switch {
	case strings.Contains(line, "observability-up.sh"):
		f.networks = true
	case strings.Contains(line, "observability_setup.py status"):
		if f.grafanaSet {
			io.WriteString(c.Out, "Creating crate-api-run\n{\"grafana-admin-password\": true}\n")
		} else {
			io.WriteString(c.Out, "{\"grafana-admin-password\": false}\n")
		}
	case strings.Contains(line, "observability_setup.py prepare"):
		if f.setupFailed != "" {
			return &system.CommandError{Command: c.Name, Err: errors.New("exit 1"), Stderr: "Monitoring setup: " + f.setupFailed}
		}
		io.WriteString(c.Out, "{\"created\": [], \"written\": []}\n")
	default:
		io.WriteString(c.Out, "{}\n")
	}
	return nil
}

func (f *fakeRunner) index(kind, match string) int {
	return slices.IndexFunc(f.events, func(e event) bool { return e.kind == kind && strings.Contains(e.line, match) })
}

func grafana(t *testing.T) string {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/health" {
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	_, port, err := net.SplitHostPort(strings.TrimPrefix(server.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	return port
}

func installation(t *testing.T, files string) string {
	t.Helper()
	dir := t.TempDir()
	values := envfile.New()
	values.Set("DATA_DIR", filepath.Join(dir, "data"))
	values.Set("CRATE_POSTGRES_DB", "crate")
	values.Set("REDIS_PASSWORD", "redis-secret-in-env")
	if files != "" {
		values.Set("COMPOSE_FILE", files)
	}
	if err := envfile.Write(install.EnvPath(dir), envfile.Render(values, "", nil)); err != nil {
		t.Fatal(err)
	}
	return dir
}

func monitor(dir string, run *fakeRunner, env map[string]string) Monitor {
	return Monitor{
		Dir: dir, Run: run, Version: "v3.2.0", Out: io.Discard,
		Docker:  system.Docker{Docker: []string{"sudo", "docker"}, Compose: []string{"sudo", "docker", "compose"}},
		Host:    system.Host{OS: "linux"},
		Getenv:  func(key string) string { return env[key] },
		Resolve: func(path string) (string, error) { return path, nil },
		HTTP:    &http.Client{Timeout: time.Second},
		Wait:    time.Second,
	}
}

func composeFile(t *testing.T, dir string) string {
	t.Helper()
	values, err := install.ReadExisting(dir)
	if err != nil {
		t.Fatal(err)
	}
	files, _ := values.Get("COMPOSE_FILE")
	return files
}

func TestEnableStartsMonitoringBeforeConnectingCrate(t *testing.T) {
	dir := installation(t, "")
	run := &fakeRunner{}
	port := grafana(t)
	secret := "a-strong-grafana-password"

	result, err := monitor(dir, run, map[string]string{"CRATE_GRAFANA_PORT": port, "CRATE_GRAFANA_PASSWORD": secret}).Enable(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	order := []int{
		run.index("stream", "up -d --wait crate-postgres"),
		run.index("run", "observability_setup.py status"),
		run.index("run", "observability_setup.py prepare"),
		run.index("run", "observability_setup.py role"),
		run.index("run", "observability-up.sh"),
		run.index("stream", appMetrics),
	}
	for i, position := range order {
		if position < 0 || (i > 0 && position < order[i-1]) {
			t.Fatalf("step %d out of order: %v\n%v", i, order, run.events)
		}
	}
	if result.Password != secret || result.Generated || result.URL != "http://localhost:"+port {
		t.Fatalf("result %+v", result)
	}
	prepare := run.events[run.index("run", "observability_setup.py prepare")]
	if !slices.Contains(prepare.env, "GRAFANA_ADMIN_PASSWORD="+secret) || !strings.Contains(prepare.line, "--preserve-env=GRAFANA_ADMIN_PASSWORD") {
		t.Fatalf("prepare %+v", prepare)
	}
	up := run.events[run.index("run", "observability-up.sh")]
	for _, want := range []string{"DOCKER=sudo docker", "OBS_CONTAINERD=0", "OBS_ENV_FILE=" + filepath.Join(dir, EnvName)} {
		if !slices.Contains(up.env, want) {
			t.Errorf("up script env %v lacks %s", up.env, want)
		}
	}
	for _, e := range run.events {
		for _, value := range []string{secret, "redis-secret-in-env"} {
			if strings.Contains(e.line, value) {
				t.Fatalf("a secret reached the command line: %s", e.line)
			}
		}
	}
	if got := composeFile(t, dir); got != "docker-compose.yaml:"+projector+":"+traefik+":"+appMetrics {
		t.Fatalf("COMPOSE_FILE %q", got)
	}
	values, _ := install.ReadExisting(dir)
	if url, _ := values.Get("CRATE_GRAFANA_URL"); url != result.URL {
		t.Fatalf("CRATE_GRAFANA_URL %q", url)
	}
	stored, err := envfile.Read(filepath.Join(dir, EnvName))
	if err != nil {
		t.Fatal(err)
	}
	if data, _ := stored.Get("OBS_DATA_DIR"); data != filepath.Join(dir, "data", "observability") {
		t.Fatalf("OBS_DATA_DIR %q", data)
	}
	if release, _ := stored.Get("OBS_RELEASE"); release != "v3.2.0" {
		t.Fatalf("OBS_RELEASE %q", release)
	}
	for _, script := range []string{"scripts/observability_setup.py", "scripts/observability-up.sh", "deploy/observability/compose.standalone.yaml"} {
		if _, err := os.Stat(filepath.Join(dir, script)); err != nil {
			t.Errorf("%s was not written: %v", script, err)
		}
	}
}

func TestEnableGeneratesAPasswordOnlyWhenGrafanaHasNone(t *testing.T) {
	cases := []struct {
		name      string
		stored    bool
		generated bool
	}{
		{"first time", false, true},
		{"already set", true, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := installation(t, "")
			run := &fakeRunner{grafanaSet: tc.stored}

			result, err := monitor(dir, run, map[string]string{"CRATE_GRAFANA_PORT": grafana(t)}).Enable(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if result.Generated != tc.generated || (result.Password != "") != tc.generated {
				t.Fatalf("result %+v", result)
			}
			if tc.generated && len(result.Password) < 20 {
				t.Fatalf("weak generated password %q", result.Password)
			}
			prepare := run.events[run.index("run", "observability_setup.py prepare")]
			if (len(prepare.env) > 0) != tc.generated {
				t.Fatalf("prepare env %v", prepare.env)
			}
			for _, e := range run.events {
				if tc.generated && strings.Contains(e.line, result.Password) {
					t.Fatalf("the generated password reached the command line: %s", e.line)
				}
			}
		})
	}
}

func TestEnableAddsTheSupervisorOverlayOnlyWithCrateOperator(t *testing.T) {
	cases := []struct {
		name, files, want string
	}{
		{"without operator", "", "docker-compose.yaml:" + projector + ":" + traefik + ":" + appMetrics},
		{"with operator", "docker-compose.yaml:" + operator,
			"docker-compose.yaml:" + operator + ":" + projector + ":" + traefik + ":" + appMetrics + ":" + supervisor},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := installation(t, tc.files)
			run := &fakeRunner{}
			if _, err := monitor(dir, run, map[string]string{"CRATE_GRAFANA_PORT": grafana(t)}).Enable(context.Background()); err != nil {
				t.Fatal(err)
			}
			if got := composeFile(t, dir); got != tc.want {
				t.Fatalf("COMPOSE_FILE %q", got)
			}
			up := run.events[run.index("stream", appMetrics)].line
			if strings.Contains(up, supervisor) != strings.Contains(tc.want, supervisor) {
				t.Fatalf("app up %s", up)
			}
		})
	}
}

func TestEnableRefusesHostsMonitoringCannotRunOn(t *testing.T) {
	dir := installation(t, "")
	run := &fakeRunner{}
	m := monitor(dir, run, nil)
	m.Host = system.Host{OS: "darwin"}

	_, err := m.Enable(context.Background())

	if err == nil || !strings.Contains(err.Error(), "needs Linux") {
		t.Fatalf("error %v", err)
	}
	if len(run.events) != 0 {
		t.Fatalf("calls on an unsupported host: %v", run.events)
	}
}

func TestEnableRefusesFilesFromANewerInstaller(t *testing.T) {
	dir := installation(t, "")
	stored := envfile.New()
	stored.Set("OBS_RELEASE", "v9.0.0")
	if err := envfile.Write(filepath.Join(dir, EnvName), envfile.Render(stored, "", nil)); err != nil {
		t.Fatal(err)
	}

	_, err := monitor(dir, &fakeRunner{}, nil).Enable(context.Background())

	if err == nil || !strings.Contains(err.Error(), "v9.0.0") {
		t.Fatalf("error %v", err)
	}
}

func TestEnableKeepsTheSetupExplanation(t *testing.T) {
	dir := installation(t, "")
	run := &fakeRunner{setupFailed: "REDIS_PASSWORD is missing from .env"}

	_, err := monitor(dir, run, map[string]string{"CRATE_GRAFANA_PORT": grafana(t)}).Enable(context.Background())

	if err == nil || !strings.HasSuffix(err.Error(), "REDIS_PASSWORD is missing from .env") {
		t.Fatalf("error %v", err)
	}
	if run.index("run", "observability-up.sh") >= 0 || run.index("stream", appMetrics) >= 0 {
		t.Fatal("monitoring started after a failed prepare")
	}
}

func enabled(t *testing.T, files string) (string, string) {
	t.Helper()
	dir := installation(t, files)
	port := grafana(t)
	if _, err := monitor(dir, &fakeRunner{}, map[string]string{"CRATE_GRAFANA_PORT": port, "CRATE_GRAFANA_PASSWORD": "a-strong-grafana-password"}).Enable(context.Background()); err != nil {
		t.Fatal(err)
	}
	return dir, port
}

func TestDisableStopsMonitoringAndKeepsItsData(t *testing.T) {
	dir, _ := enabled(t, "docker-compose.yaml:"+operator)
	run := &fakeRunner{networks: true}

	if err := monitor(dir, run, nil).Disable(context.Background()); err != nil {
		t.Fatal(err)
	}

	if got := composeFile(t, dir); got != "docker-compose.yaml:"+operator {
		t.Fatalf("COMPOSE_FILE %q", got)
	}
	values, _ := install.ReadExisting(dir)
	if _, ok := values.Get("CRATE_GRAFANA_URL"); ok {
		t.Fatal("CRATE_GRAFANA_URL points at a stopped Grafana")
	}
	app := run.index("stream", "up -d")
	stop := run.index("stream", "stop")
	if app < 0 || stop < app {
		t.Fatalf("Crate must leave the networks before monitoring stops: %v", run.events)
	}
	line := run.events[stop].line
	for _, service := range Services {
		if !strings.Contains(line, service) {
			t.Errorf("stop leaves %s running: %s", service, line)
		}
	}
	for _, e := range run.events {
		if strings.Contains(e.line, " down") || strings.Contains(e.line, " rm ") || strings.Contains(e.line, "volume") {
			t.Fatalf("disable removes something: %s", e.line)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, EnvName)); err != nil {
		t.Fatal("monitoring.env must stay for the next enable")
	}
}

func TestStatusReportsAMissingNetworkAndGrafana(t *testing.T) {
	dir, port := enabled(t, "")
	run := &fakeRunner{}

	report, err := monitor(dir, run, nil).Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	if !report.Configured || !report.Active || !report.GrafanaHealthy || report.GrafanaURL != "http://localhost:"+port {
		t.Fatalf("report %+v", report)
	}
	if len(report.MissingOverlays) != 3 {
		t.Fatalf("missing overlays %v", report.MissingOverlays)
	}
	if len(report.Services) != 1 || report.Services[0].Service != "crate-grafana" {
		t.Fatalf("services %+v", report.Services)
	}
	if bytes.Contains([]byte(run.events[run.index("run", "observability_setup.py status")].line), []byte("--no-database")) {
		t.Fatal("status checks the database account")
	}
}
