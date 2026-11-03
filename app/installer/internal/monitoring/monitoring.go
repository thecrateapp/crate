// Package monitoring switches the optional crate-observability project on
// and off for an installation and reports its state.
package monitoring

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/thecrateapp/crate/app/installer/internal/assets"
	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/observability"
	"github.com/thecrateapp/crate/app/installer/internal/stack"
	"github.com/thecrateapp/crate/app/installer/internal/system"
)

// Services are the monitoring project's containers.
var Services = []string{
	"crate-prometheus", "crate-grafana", "crate-node-exporter", "crate-postgres-exporter",
	"crate-redis-exporter", "crate-redis-durable-exporter", "crate-cadvisor", "crate-observability-docker-proxy",
}

const (
	EnvName     = "monitoring.env"
	DefaultPort = "3001"
	GrafanaUser = "admin"
)

// Monitor drives monitoring for the installation in Dir.
type Monitor struct {
	Dir     string
	Run     system.Runner
	Docker  system.Docker
	Host    system.Host
	Version string
	Getenv  func(string) string
	Resolve func(string) (string, error)
	HTTP    *http.Client
	Out     io.Writer
	Wait    time.Duration
}

// New returns a Monitor for the real host.
func New(dir, version string, run system.Runner, docker system.Docker, host system.Host, out io.Writer) Monitor {
	return Monitor{
		Dir: dir, Run: run, Docker: docker, Host: host, Version: version, Out: out,
		Getenv: os.Getenv, Resolve: filepath.EvalSymlinks,
		HTTP: &http.Client{Timeout: 5 * time.Second}, Wait: 2 * time.Minute,
	}
}

// Enabled is what the user needs to open Grafana.
type Enabled struct {
	URL       string
	Password  string
	Generated bool
}

func (m Monitor) envPath() string {
	return filepath.Join(m.Dir, EnvName)
}

func (m Monitor) installation() (*envfile.Values, error) {
	values, err := install.ReadExisting(m.Dir)
	if err != nil {
		return nil, err
	}
	if values == nil {
		return nil, fmt.Errorf("no Crate installation in %s; run `crate install` first", m.Dir)
	}
	return values, nil
}

func (m Monitor) stored() *envfile.Values {
	values, err := envfile.Read(m.envPath())
	if err != nil {
		return nil
	}
	return values
}

func value(values *envfile.Values, key string) string {
	if values == nil {
		return ""
	}
	v, _ := values.Get(key)
	return strings.TrimSpace(v)
}

// Availability says whether this host can run monitoring.
func (m Monitor) Availability(ctx context.Context) observability.Availability {
	availability, _ := m.assess(ctx)
	return availability
}

func (m Monitor) assess(ctx context.Context) (observability.Availability, observability.Engine) {
	if m.Host.OS != "linux" {
		return observability.Assess(m.Host, observability.Engine{}, m.Resolve), observability.Engine{}
	}
	engine, err := observability.Detect(ctx, m.Run, m.Docker)
	if err != nil {
		return observability.Availability{Reason: "Docker did not report its storage driver"}, engine
	}
	return observability.Assess(m.Host, engine, m.Resolve), engine
}

func (m Monitor) settings(app *envfile.Values, availability observability.Availability, engine observability.Engine) (observability.Settings, error) {
	previous := m.stored()
	if release := value(previous, "OBS_RELEASE"); !observability.MayWrite(release, m.Version) {
		return observability.Settings{}, fmt.Errorf("monitoring was set up by crate %s; use that version or newer", release)
	}
	dir := value(previous, "OBS_DATA_DIR")
	if dir == "" {
		dir = strings.TrimSpace(m.Getenv("CRATE_OBSERVABILITY_DIR"))
	}
	if dir == "" {
		data := value(app, "DATA_DIR")
		if data == "" {
			data = "data"
		}
		if !filepath.IsAbs(data) {
			data = filepath.Join(m.Dir, data)
		}
		dir = observability.DefaultDataDir(data)
	}
	if !filepath.IsAbs(dir) {
		return observability.Settings{}, fmt.Errorf("the monitoring data folder must be an absolute path, not %q", dir)
	}
	port := strings.TrimSpace(m.Getenv("CRATE_GRAFANA_PORT"))
	if port == "" {
		port = value(previous, "OBS_GRAFANA_PORT")
	}
	if port == "" {
		port = DefaultPort
	}
	if n, err := strconv.Atoi(port); err != nil || n < 1 || n > 65535 {
		return observability.Settings{}, fmt.Errorf("Grafana port %q is not a port number", port)
	}
	database := value(app, "CRATE_POSTGRES_DB")
	if database == "" {
		database = "crate"
	}
	root := engine.DockerRoot
	if root == "" {
		root = "/var/lib/docker"
	}
	return observability.Settings{
		DataDir: filepath.Clean(dir), AppNetwork: "crate", Database: database, GrafanaPort: port,
		DockerRoot: root, Containerd: availability.Containerd, Socket: availability.Socket, Release: m.Version,
	}, nil
}

func (m Monitor) app(values *envfile.Values) stack.Stack {
	return stack.Stack{Run: m.Run, Compose: m.Docker.Compose, Dir: m.Dir, Files: install.ComposeFiles(values), Env: values}
}

func within(path, parent string) bool {
	relative, err := filepath.Rel(parent, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

// setup runs scripts/observability_setup.py in a throwaway crate-api
// container as root, with the install and monitoring folders at their host
// paths. Secrets reach it only through the child environment.
func (m Monitor) setup(ctx context.Context, app stack.Stack, dataDir string, env map[string]string, args ...string) (string, error) {
	run := []string{"run", "--rm", "--no-deps", "-T", "--user", "0:0", "--entrypoint", "python", "--label", "traefik.enable=false", "--volume", m.Dir + ":" + m.Dir}
	if !within(dataDir, m.Dir) {
		run = append(run, "--volume", dataDir+":"+dataDir)
	}
	var names, environment []string
	for name, v := range env {
		if v != "" {
			names = append(names, name)
			environment = append(environment, name+"="+v)
		}
	}
	for _, name := range names {
		run = append(run, "--env", name)
	}
	run = append(run, "crate-api", filepath.Join(m.Dir, "scripts", assets.ObservabilitySetup))
	run = append(run, args...)
	run = append(run, "--env-file", install.EnvPath(m.Dir), "--monitoring-env", m.envPath())
	name, full := app.Command(ctx, run...)
	if name == "sudo" && len(names) > 0 {
		full = append([]string{"--preserve-env=" + strings.Join(names, ",")}, full...)
	}
	var out bytes.Buffer
	err := m.Run.Run(ctx, system.Command{Dir: m.Dir, Name: name, Args: full, Env: environment, Out: &out})
	var failed *system.CommandError
	if errors.As(err, &failed) {
		if message, ok := strings.CutPrefix(failed.Stderr, "Monitoring setup: "); ok {
			return "", errors.New(message)
		}
	}
	return lastJSON(out.String()), err
}

func lastJSON(out string) string {
	lines := strings.Split(strings.TrimSpace(out), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if line := strings.TrimSpace(lines[i]); strings.HasPrefix(line, "{") {
			return line
		}
	}
	return ""
}

func (m Monitor) setupStatus(ctx context.Context, app stack.Stack, dataDir string, database bool) (map[string]bool, error) {
	args := []string{"status"}
	if !database {
		args = append(args, "--no-database")
	}
	out, err := m.setup(ctx, app, dataDir, nil, args...)
	if err != nil {
		return nil, err
	}
	report := map[string]bool{}
	if err := json.Unmarshal([]byte(out), &report); err != nil {
		return nil, fmt.Errorf("read the monitoring setup status: %w", err)
	}
	return report, nil
}

func (m Monitor) dockerPrefix() string {
	return strings.Join(m.Docker.Docker, " ")
}

// compose is the monitoring project's compose invocation.
func (m Monitor) compose(containerd bool, args ...string) (string, []string) {
	full := append(append([]string(nil), m.Docker.Compose[1:]...),
		"--project-name", observability.Project, "--project-directory", m.Dir,
		"--env-file", m.envPath(),
		"-f", filepath.Join(m.Dir, "deploy", "observability", "compose.standalone.yaml"))
	if containerd {
		full = append(full, "-f", filepath.Join(m.Dir, "deploy", "observability", "compose.containerd.yaml"))
	}
	full = append(full, "--profile", "observability")
	return m.Docker.Compose[0], append(full, args...)
}

func password() (string, error) {
	raw := make([]byte, 18)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func (m Monitor) grafanaURL(port string) string {
	return "http://localhost:" + port
}

// GrafanaHealthy asks Grafana on this machine whether it is up.
func (m Monitor) GrafanaHealthy(ctx context.Context, port string) bool {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:"+port+"/api/health", nil)
	if err != nil {
		return false
	}
	response, err := m.HTTP.Do(request)
	if err != nil {
		return false
	}
	response.Body.Close()
	return response.StatusCode == http.StatusOK
}

func (m Monitor) waitGrafana(ctx context.Context, port string) error {
	deadline := time.Now().Add(m.Wait)
	for {
		if m.GrafanaHealthy(ctx, port) {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("Grafana did not answer at %s within %s", m.grafanaURL(port), m.Wait)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

func (m Monitor) writeEnv(values *envfile.Values) error {
	man, err := manifest.Load()
	if err != nil {
		return err
	}
	return envfile.Write(install.EnvPath(m.Dir), envfile.Render(values, install.EnvHeader, install.Sections(man)))
}

func (m Monitor) step(text string) {
	fmt.Fprintln(m.Out, text)
}

// Enable sets monitoring up and switches the application overlays on.
// Monitoring starts first, because the overlays join networks it creates.
func (m Monitor) Enable(ctx context.Context) (Enabled, error) {
	values, err := m.installation()
	if err != nil {
		return Enabled{}, err
	}
	availability, engine := m.assess(ctx)
	if !availability.Available {
		return Enabled{}, fmt.Errorf("monitoring is not available here: %s", availability.Reason)
	}
	settings, err := m.settings(values, availability, engine)
	if err != nil {
		return Enabled{}, err
	}
	if err := install.WriteAssets(m.Dir, assets.Monitoring); err != nil {
		return Enabled{}, err
	}
	if err := envfile.Write(m.envPath(), envfile.Render(observability.Env(settings), "# Crate monitoring, written by `crate observability`.\n", nil)); err != nil {
		return Enabled{}, err
	}

	app := m.app(values)
	m.step("Starting the database")
	name, args := app.Command(ctx, "up", "-d", "--wait", "crate-postgres")
	if err := m.Run.Stream(ctx, m.Out, m.Dir, name, args...); err != nil {
		return Enabled{}, fmt.Errorf("start the database: %w", err)
	}
	status, err := m.setupStatus(ctx, app, settings.DataDir, false)
	if err != nil {
		return Enabled{}, fmt.Errorf("check the monitoring folders: %w", err)
	}
	result := Enabled{URL: m.grafanaURL(settings.GrafanaPort)}
	secret := strings.TrimSpace(m.Getenv("CRATE_GRAFANA_PASSWORD"))
	if !status["grafana-admin-password"] {
		if secret == "" {
			if secret, err = password(); err != nil {
				return Enabled{}, err
			}
			result.Generated = true
		} else if len(secret) < 12 {
			return Enabled{}, errors.New("CRATE_GRAFANA_PASSWORD needs at least 12 characters")
		}
		result.Password = secret
	}
	m.step("Preparing the monitoring folders and secrets")
	if _, err := m.setup(ctx, app, settings.DataDir, map[string]string{"GRAFANA_ADMIN_PASSWORD": result.Password}, "prepare"); err != nil {
		return Enabled{}, fmt.Errorf("prepare monitoring: %w", err)
	}
	m.step("Creating the read-only database account for monitoring")
	if _, err := m.setup(ctx, app, settings.DataDir, nil, "role"); err != nil {
		return Enabled{}, fmt.Errorf("create the monitoring database account: %w", err)
	}
	m.step("Starting monitoring")
	containerd := "0"
	if settings.Containerd {
		containerd = "1"
	}
	up := system.Command{
		Dir: m.Dir, Name: "sh", Args: []string{filepath.Join(m.Dir, "scripts", assets.ObservabilityUp)}, Out: m.Out,
		Env: []string{
			"OBS_PROJECT_DIR=" + m.Dir, "OBS_ENV_FILE=" + m.envPath(), "OBS_CONTAINERD=" + containerd,
			"OBS_CONTAINERD_SOCKET=" + settings.Socket, "DOCKER=" + m.dockerPrefix(),
		},
	}
	if err := m.Run.Run(ctx, up); err != nil {
		return Enabled{}, fmt.Errorf("start monitoring: %w", err)
	}

	observability.Activate(values)
	values.Set("CRATE_GRAFANA_URL", result.URL)
	if err := m.writeEnv(values); err != nil {
		return Enabled{}, err
	}
	m.step("Connecting Crate to monitoring")
	if err := m.app(values).Up(ctx, m.Out); err != nil {
		return Enabled{}, fmt.Errorf("restart Crate with monitoring: %w", err)
	}
	if err := m.waitGrafana(ctx, settings.GrafanaPort); err != nil {
		return Enabled{}, err
	}
	return result, nil
}

// Disable switches the application overlays off and stops monitoring. Data,
// secrets, networks and the database account stay for the next enable.
func (m Monitor) Disable(ctx context.Context) error {
	values, err := m.installation()
	if err != nil {
		return err
	}
	stored := m.stored()
	if !observability.Active(values) && stored == nil {
		return errors.New("monitoring is not set up in this installation")
	}
	if observability.Active(values) {
		observability.Deactivate(values)
		if value(values, "CRATE_GRAFANA_URL") == m.grafanaURL(value(stored, "OBS_GRAFANA_PORT")) {
			values.Delete("CRATE_GRAFANA_URL")
		}
		if err := m.writeEnv(values); err != nil {
			return err
		}
		m.step("Disconnecting Crate from monitoring")
		if err := m.app(values).Up(ctx, m.Out); err != nil {
			return fmt.Errorf("restart Crate without monitoring: %w", err)
		}
	}
	if stored == nil {
		return nil
	}
	m.step("Stopping monitoring")
	name, args := m.compose(value(stored, "OBS_CONTAINERD") == "1", append([]string{"stop"}, Services...)...)
	if err := m.Run.Stream(ctx, m.Out, m.Dir, name, args...); err != nil {
		return fmt.Errorf("stop monitoring: %w", err)
	}
	return nil
}

// Report is what `crate observability status` shows.
type Report struct {
	Configured      bool
	Active          bool
	MissingOverlays []string
	Services        []stack.Service
	Setup           map[string]bool
	GrafanaURL      string
	GrafanaHealthy  bool
	Availability    observability.Availability
}

// Status reads the monitoring state without changing anything, including
// the setup state, which takes a throwaway crate-api container.
func (m Monitor) Status(ctx context.Context) (Report, error) {
	report, err := m.Inspect(ctx)
	if err != nil || !report.Configured {
		return report, err
	}
	values, err := m.installation()
	if err != nil {
		return report, err
	}
	report.Setup, _ = m.setupStatus(ctx, m.app(values), value(m.stored(), "OBS_DATA_DIR"), true)
	return report, nil
}

// Inspect reads the monitoring state from compose, the networks and Grafana
// only.
func (m Monitor) Inspect(ctx context.Context) (Report, error) {
	values, err := m.installation()
	if err != nil {
		return Report{}, err
	}
	report := Report{Availability: m.Availability(ctx), Active: observability.Active(values)}
	app := m.app(values)
	_, report.MissingOverlays = app.ActiveFiles(ctx)
	stored := m.stored()
	if stored == nil {
		return report, nil
	}
	report.Configured = true
	port := value(stored, "OBS_GRAFANA_PORT")
	report.GrafanaURL = m.grafanaURL(port)
	name, args := m.compose(value(stored, "OBS_CONTAINERD") == "1", "ps", "--all", "--format", "json")
	if out, err := m.Run.Output(ctx, name, args...); err == nil {
		report.Services, _ = stack.ParseServices(out)
	}
	report.GrafanaHealthy = m.GrafanaHealthy(ctx, port)
	return report, nil
}
