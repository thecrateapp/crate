// Package observability decides whether this host can run the optional
// monitoring project and holds the settings that switch it on: the separate
// monitoring.env and the application overlays in COMPOSE_FILE.
package observability

import (
	"context"
	"fmt"
	"maps"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/system"
)

// Project is the compose project monitoring runs as; its networks carry
// this prefix.
const Project = "crate-observability"

// InfoFormat is the `docker info --format` template ParseInfo reads.
const InfoFormat = "{{.Driver}}|{{.Containerd.Address}}|{{.DockerRootDir}}|{{.SecurityOptions}}"

// Engine is what the Docker daemon and Compose report about this host.
type Engine struct {
	Driver     string
	Containerd string
	DockerRoot string
	Rootless   bool
	Compose    string
}

// ParseInfo reads the output of `docker info --format InfoFormat`.
func ParseInfo(out string) (Engine, error) {
	parts := strings.SplitN(strings.TrimSpace(out), "|", 4)
	if len(parts) != 4 || parts[0] == "" {
		return Engine{}, fmt.Errorf("unexpected docker info output %q", out)
	}
	return Engine{
		Driver:     parts[0],
		Containerd: parts[1],
		DockerRoot: parts[2],
		Rootless:   strings.Contains(parts[3], "name=rootless"),
	}, nil
}

// Detect asks the daemon and Compose for the facts Assess needs.
func Detect(ctx context.Context, run system.Runner, docker system.Docker) (Engine, error) {
	out, err := run.Output(ctx, docker.Docker[0], append(docker.Docker[1:], "info", "--format", InfoFormat)...)
	if err != nil {
		return Engine{}, fmt.Errorf("docker info: %w", err)
	}
	engine, err := ParseInfo(out)
	if err != nil {
		return Engine{}, err
	}
	if len(docker.Compose) > 0 {
		engine.Compose, _ = run.Output(ctx, docker.Compose[0], append(docker.Compose[1:], "version", "--short")...)
	}
	return engine, nil
}

var composeMajor = regexp.MustCompile(`^v?(\d+)\.`)

// ComposeV2 reports whether a `compose version --short` string is Compose v2
// or later; the monitoring compose uses extends, file secrets and
// create_host_path.
func ComposeV2(version string) bool {
	match := composeMajor.FindStringSubmatch(strings.TrimSpace(version))
	if match == nil {
		return false
	}
	major, err := strconv.Atoi(match[1])
	return err == nil && major >= 2
}

// Availability says whether monitoring can run here and, when it cannot,
// why, in words the wizard shows next to the option.
type Availability struct {
	Available  bool
	Reason     string
	Containerd bool
	Socket     string
}

// Assess applies the v1 rules: Linux, the system Docker daemon, overlay2 or
// the containerd image store with its socket under /run, and Compose v2.
// resolve follows symlinks of the containerd socket path.
func Assess(host system.Host, engine Engine, resolve func(string) (string, error)) Availability {
	switch {
	case host.OS != "linux":
		return Availability{Reason: "needs Linux: on this system the host collectors would measure Docker's virtual machine, not this computer"}
	case engine.Rootless:
		return Availability{Reason: "Docker runs rootless; the host collectors need the system Docker daemon"}
	case !ComposeV2(engine.Compose):
		return Availability{Reason: "needs Docker Compose v2"}
	}
	switch engine.Driver {
	case "overlay2":
		return Availability{Available: true, Socket: engine.Containerd}
	case "overlayfs":
		socket, err := resolve(engine.Containerd)
		if err != nil || !strings.HasPrefix(filepath.Clean(socket), "/run/") {
			return Availability{Reason: "the containerd socket is not under /run"}
		}
		return Availability{Available: true, Containerd: true, Socket: socket}
	default:
		return Availability{Reason: fmt.Sprintf("Docker storage driver %s is not supported", engine.Driver)}
	}
}

// Settings are the values monitoring.env carries.
type Settings struct {
	DataDir     string
	AppNetwork  string
	Database    string
	GrafanaPort string
	DockerRoot  string
	Containerd  bool
	Socket      string
	Release     string
}

// DefaultDataDir keeps monitoring data next to Crate's own data.
func DefaultDataDir(dataDir string) string {
	return filepath.Join(dataDir, "observability")
}

// Env builds monitoring.env. Secrets never go in it; they live as files
// under the secrets directory.
func Env(s Settings) *envfile.Values {
	containerd := "0"
	if s.Containerd {
		containerd = "1"
	}
	values := envfile.New()
	values.Set("OBS_DATA_DIR", s.DataDir)
	values.Set("OBS_SECRETS_DIR", filepath.Join(s.DataDir, "secrets"))
	values.Set("OBS_APP_NETWORK", s.AppNetwork)
	values.Set("CRATE_POSTGRES_DB", s.Database)
	values.Set("OBS_GRAFANA_PORT", s.GrafanaPort)
	values.Set("OBS_DOCKER_ROOT", s.DockerRoot)
	values.Set("OBS_CONTAINERD_SOCKET", s.Socket)
	values.Set("OBS_CONTAINERD", containerd)
	values.Set("OBS_RELEASE", s.Release)
	return values
}

// MountedFiles maps each monitoring file a running service reads at start,
// relative to deploy/observability, to that service. A change to one needs a
// restart; scripts/observability_release.py keeps the same map.
var MountedFiles = map[string]string{
	"prometheus.yml":                                      "crate-prometheus",
	"recording-rules.yml":                                 "crate-prometheus",
	"docker-proxy.haproxy.cfg":                            "crate-observability-docker-proxy",
	"runtime-proxy.haproxy.cfg":                           "crate-observability-docker-proxy",
	"grafana/provisioning/dashboards/infrastructure.yaml": "crate-grafana",
	"grafana/provisioning/datasources/prometheus.yaml":    "crate-grafana",
}

// Overlay is an application compose overlay that joins a network the
// monitoring project creates.
type Overlay struct {
	File     string
	Network  string
	Operator bool
}

// Overlays are applied in this order, after the base and operator files.
var Overlays = []Overlay{
	{File: "deploy/observability/compose.projector-prometheus.yaml", Network: "OBS_PROMETHEUS_QUERY_NETWORK"},
	{File: "deploy/observability/compose.traefik-metrics.yaml", Network: "OBS_TRAEFIK_METRICS_NETWORK"},
	{File: "deploy/observability/compose.app-metrics.yaml", Network: "OBS_APP_METRICS_NETWORK"},
	{File: "deploy/observability/compose.supervisor-prometheus.yaml", Network: "OBS_PROMETHEUS_QUERY_NETWORK", Operator: true},
}

// Networks maps each overlay network variable to the network the monitoring
// project creates.
var Networks = map[string]string{
	"OBS_PROMETHEUS_QUERY_NETWORK": Project + "_prometheus-query",
	"OBS_TRAEFIK_METRICS_NETWORK":  Project + "_traefik-metrics",
	"OBS_APP_METRICS_NETWORK":      Project + "_app-metrics",
}

const operatorOverlay = "compose.operator.yaml"

func composeFiles(values *envfile.Values) []string {
	raw, _ := values.Get("COMPOSE_FILE")
	return slices.DeleteFunc(strings.Split(raw, ":"), func(f string) bool {
		return strings.TrimSpace(f) == ""
	})
}

func isOverlay(file string) bool {
	return slices.ContainsFunc(Overlays, func(o Overlay) bool { return o.File == file })
}

func setFiles(values *envfile.Values, files []string) {
	if len(files) == 0 || (len(files) == 1 && files[0] == "docker-compose.yaml") {
		values.Delete("COMPOSE_FILE")
		return
	}
	values.Set("COMPOSE_FILE", strings.Join(files, ":"))
}

// Activate adds the application overlays to COMPOSE_FILE after every other
// file, the supervisor one only with Crate Operator, and points each overlay
// network variable at the monitoring project unless it is already set.
func Activate(values *envfile.Values) {
	files := slices.DeleteFunc(composeFiles(values), isOverlay)
	if len(files) == 0 {
		files = []string{"docker-compose.yaml"}
	}
	operator := slices.ContainsFunc(files, func(f string) bool { return filepath.Base(f) == operatorOverlay })
	for _, overlay := range Overlays {
		if overlay.Operator && !operator {
			continue
		}
		files = append(files, overlay.File)
	}
	setFiles(values, files)
	for _, key := range slices.Sorted(maps.Keys(Networks)) {
		if current, _ := values.Get(key); strings.TrimSpace(current) == "" {
			values.Set(key, Networks[key])
		}
	}
}

// Deactivate removes the application overlays from COMPOSE_FILE. The network
// variables stay; without their overlays nothing reads them.
func Deactivate(values *envfile.Values) {
	setFiles(values, slices.DeleteFunc(composeFiles(values), isOverlay))
}

// Active reports whether any application overlay is in COMPOSE_FILE.
func Active(values *envfile.Values) bool {
	return slices.ContainsFunc(composeFiles(values), isOverlay)
}

// Select drops the overlays whose network does not exist, so a lost
// monitoring network never stops the application from starting. It returns
// the files to use and the overlays it left out.
func Select(files []string, values *envfile.Values, exists func(network string) bool) (kept, dropped []string) {
	if values == nil {
		values = envfile.New()
	}
	checked := map[string]bool{}
	for _, file := range files {
		index := slices.IndexFunc(Overlays, func(o Overlay) bool { return o.File == file })
		if index < 0 {
			kept = append(kept, file)
			continue
		}
		network, _ := values.Get(Overlays[index].Network)
		if strings.TrimSpace(network) == "" {
			network = Networks[Overlays[index].Network]
		}
		found, ok := checked[network]
		if !ok {
			found = exists(network)
			checked[network] = found
		}
		if found {
			kept = append(kept, file)
		} else {
			dropped = append(dropped, file)
		}
	}
	return kept, dropped
}

// NetworkExists asks the daemon whether a network exists.
func NetworkExists(ctx context.Context, run system.Runner, docker system.Docker) func(string) bool {
	return func(network string) bool {
		_, err := run.Output(ctx, docker.Docker[0], append(docker.Docker[1:], "network", "inspect", network)...)
		return err == nil
	}
}

var releaseVersion = regexp.MustCompile(`^v(\d+)\.(\d+)\.(\d+)$`)

func release(version string) ([]int, bool) {
	match := releaseVersion.FindStringSubmatch(version)
	if match == nil {
		return nil, false
	}
	parts := make([]int, 0, 3)
	for _, part := range match[1:] {
		n, err := strconv.Atoi(part)
		if err != nil {
			return nil, false
		}
		parts = append(parts, n)
	}
	return parts, true
}

// MayWrite reports whether an installer of version may rewrite the monitoring
// files recorded as OBS_RELEASE=current. A release installer never replaces
// files from a newer release: an older Grafana image cannot open a database a
// newer one migrated. Development builds only write over development builds.
func MayWrite(current, version string) bool {
	if strings.TrimSpace(current) == "" {
		return true
	}
	installed, installedRelease := release(current)
	candidate, candidateRelease := release(version)
	switch {
	case candidateRelease && installedRelease:
		return slices.Compare(candidate, installed) >= 0
	case candidateRelease:
		return true
	default:
		return !installedRelease
	}
}
