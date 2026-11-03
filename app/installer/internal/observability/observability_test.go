package observability

import (
	"context"
	"errors"
	"io"
	"maps"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/system"
)

func values(pairs ...string) *envfile.Values {
	v := envfile.New()
	for i := 0; i+1 < len(pairs); i += 2 {
		v.Set(pairs[i], pairs[i+1])
	}
	return v
}

func TestParseInfo(t *testing.T) {
	cases := []struct {
		name string
		out  string
		want Engine
		err  bool
	}{
		{"overlay2", "overlay2|/run/containerd/containerd.sock|/var/lib/docker|[name=apparmor name=seccomp,profile=builtin name=cgroupns]",
			Engine{Driver: "overlay2", Containerd: "/run/containerd/containerd.sock", DockerRoot: "/var/lib/docker"}, false},
		{"containerd store", "overlayfs|/run/containerd/containerd.sock|/var/lib/docker|[name=seccomp,profile=builtin]",
			Engine{Driver: "overlayfs", Containerd: "/run/containerd/containerd.sock", DockerRoot: "/var/lib/docker"}, false},
		{"rootless", "overlay2|/run/user/1000/docker/containerd/containerd.sock|/home/u/.local/share/docker|[name=seccomp,profile=builtin name=rootless]",
			Engine{Driver: "overlay2", Containerd: "/run/user/1000/docker/containerd/containerd.sock", DockerRoot: "/home/u/.local/share/docker", Rootless: true}, false},
		{"garbage", "permission denied", Engine{}, true},
		{"empty driver", "|a|b|c", Engine{}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ParseInfo(tc.out)
			if (err != nil) != tc.err {
				t.Fatalf("error %v, want error %v", err, tc.err)
			}
			if got != tc.want {
				t.Fatalf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestComposeV2(t *testing.T) {
	cases := map[string]bool{"2.29.1": true, "v2.32.4": true, "3.0.0": true, "1.29.2": false, "": false, "unknown": false}
	for version, want := range cases {
		if ComposeV2(version) != want {
			t.Errorf("ComposeV2(%q) = %v", version, !want)
		}
	}
}

func TestAssess(t *testing.T) {
	linux := system.Host{OS: "linux"}
	resolve := func(path string) (string, error) {
		switch path {
		case "/run/containerd/containerd.sock":
			return path, nil
		case "/var/run/containerd/containerd.sock":
			return "/run/containerd/containerd.sock", nil
		case "/opt/containerd.sock":
			return path, nil
		}
		return "", errors.New("missing")
	}
	cases := []struct {
		name   string
		host   system.Host
		engine Engine
		reason string
		want   Availability
	}{
		{name: "overlay2", host: linux, engine: Engine{Driver: "overlay2", Containerd: "/run/containerd/containerd.sock", Compose: "2.29.1"},
			want: Availability{Available: true, Socket: "/run/containerd/containerd.sock"}},
		{name: "containerd store", host: linux, engine: Engine{Driver: "overlayfs", Containerd: "/var/run/containerd/containerd.sock", Compose: "2.29.1"},
			want: Availability{Available: true, Containerd: true, Socket: "/run/containerd/containerd.sock"}},
		{name: "socket outside run", host: linux, engine: Engine{Driver: "overlayfs", Containerd: "/opt/containerd.sock", Compose: "2.29.1"},
			reason: "not under /run"},
		{name: "socket missing", host: linux, engine: Engine{Driver: "overlayfs", Containerd: "/run/gone.sock", Compose: "2.29.1"},
			reason: "not under /run"},
		{name: "macos", host: system.Host{OS: "darwin"}, engine: Engine{Driver: "overlay2", Compose: "2.29.1"},
			reason: "needs Linux"},
		{name: "rootless", host: linux, engine: Engine{Driver: "overlay2", Rootless: true, Compose: "2.29.1"},
			reason: "rootless"},
		{name: "compose v1", host: linux, engine: Engine{Driver: "overlay2", Compose: "1.29.2"},
			reason: "Compose v2"},
		{name: "other driver", host: linux, engine: Engine{Driver: "btrfs", Compose: "2.29.1"},
			reason: "storage driver btrfs"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := Assess(tc.host, tc.engine, resolve)
			if tc.reason != "" {
				if got.Available || !strings.Contains(got.Reason, tc.reason) {
					t.Fatalf("got %+v, want unavailable with %q", got, tc.reason)
				}
				return
			}
			if got != tc.want {
				t.Fatalf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}

type infoRunner struct {
	info, compose string
	networks      []string
	calls         []string
}

func (r *infoRunner) Output(_ context.Context, name string, args ...string) (string, error) {
	call := name + " " + strings.Join(args, " ")
	r.calls = append(r.calls, call)
	switch {
	case slices.Contains(args, "info"):
		return r.info, nil
	case slices.Contains(args, "version"):
		return r.compose, nil
	case slices.Contains(args, "inspect"):
		if slices.Contains(r.networks, args[len(args)-1]) {
			return "[]", nil
		}
		return "", errors.New("no such network")
	}
	return "", nil
}

func (r *infoRunner) Stream(context.Context, io.Writer, string, string, ...string) error {
	return nil
}

func (r *infoRunner) Run(context.Context, system.Command) error { return nil }

func TestDetectUsesTheInstallationsDockerCommands(t *testing.T) {
	run := &infoRunner{info: "overlay2|/run/containerd/containerd.sock|/var/lib/docker|[]", compose: "2.29.1"}
	docker := system.Docker{Docker: []string{"sudo", "docker"}, Compose: []string{"sudo", "docker", "compose"}}

	engine, err := Detect(context.Background(), run, docker)
	if err != nil {
		t.Fatal(err)
	}
	if engine.Compose != "2.29.1" || engine.Driver != "overlay2" {
		t.Fatalf("got %+v", engine)
	}
	want := []string{
		"sudo docker info --format " + InfoFormat,
		"sudo docker compose version --short",
	}
	if !slices.Equal(run.calls, want) {
		t.Fatalf("calls %q", run.calls)
	}
}

func TestEnvWritesEveryMonitoringVariableAndNoSecret(t *testing.T) {
	m, err := manifest.Load()
	if err != nil {
		t.Fatal(err)
	}
	env := Env(Settings{
		DataDir: "/srv/crate/data/observability", AppNetwork: "crate", Database: "crate",
		GrafanaPort: "3001", DockerRoot: "/var/lib/docker", Containerd: true,
		Socket: "/run/containerd/containerd.sock", Release: "v3.1.3",
	})
	var declared []string
	for _, s := range m.Monitoring.Env {
		declared = append(declared, s.Env)
		if m.Secret(s.Env) {
			t.Errorf("%s is a secret and must not be in monitoring.env", s.Env)
		}
	}
	got := env.Keys()
	slices.Sort(got)
	slices.Sort(declared)
	if !slices.Equal(got, declared) {
		t.Fatalf("monitoring.env keys %v, manifest monitoring.env %v", got, declared)
	}
	for key, want := range map[string]string{
		"OBS_SECRETS_DIR": "/srv/crate/data/observability/secrets",
		"OBS_CONTAINERD":  "1",
		"OBS_RELEASE":     "v3.1.3",
	} {
		if value, _ := env.Get(key); value != want {
			t.Errorf("%s = %q, want %q", key, value, want)
		}
	}
	if DefaultDataDir("/srv/crate/data") != "/srv/crate/data/observability" {
		t.Error("monitoring data belongs under DATA_DIR")
	}
}

const (
	projector  = "deploy/observability/compose.projector-prometheus.yaml"
	traefik    = "deploy/observability/compose.traefik-metrics.yaml"
	appMetrics = "deploy/observability/compose.app-metrics.yaml"
	supervisor = "deploy/observability/compose.supervisor-prometheus.yaml"
	operator   = "deploy/operator/compose.operator.yaml"
)

func TestActivateAndDeactivate(t *testing.T) {
	base := []string{"docker-compose.yaml", projector, traefik, appMetrics}
	cases := []struct {
		name, files string
		want        []string
		off         string
	}{
		{"plain install", "", base, ""},
		{"with operator", "docker-compose.yaml:" + operator,
			[]string{"docker-compose.yaml", operator, projector, traefik, appMetrics, supervisor},
			"docker-compose.yaml:" + operator},
		{"twice", strings.Join(base, ":"), base, ""},
		{"keeps other files", "docker-compose.yaml:mine.yaml",
			[]string{"docker-compose.yaml", "mine.yaml", projector, traefik, appMetrics},
			"docker-compose.yaml:mine.yaml"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v := values()
			if tc.files != "" {
				v.Set("COMPOSE_FILE", tc.files)
			}
			Activate(v)
			got, _ := v.Get("COMPOSE_FILE")
			if got != strings.Join(tc.want, ":") {
				t.Fatalf("COMPOSE_FILE %q", got)
			}
			if !Active(v) {
				t.Fatal("Active after Activate")
			}
			for key, network := range Networks {
				if value, _ := v.Get(key); value != network {
					t.Errorf("%s = %q", key, value)
				}
			}
			Deactivate(v)
			off, set := v.Get("COMPOSE_FILE")
			if off != tc.off || (tc.off == "" && set) {
				t.Fatalf("after Deactivate COMPOSE_FILE %q (set %v)", off, set)
			}
			if Active(v) {
				t.Fatal("Active after Deactivate")
			}
		})
	}
}

func TestActivateKeepsANetworkTheUserChose(t *testing.T) {
	v := values("OBS_APP_METRICS_NETWORK", "my-metrics")
	Activate(v)
	if got, _ := v.Get("OBS_APP_METRICS_NETWORK"); got != "my-metrics" {
		t.Fatalf("got %q", got)
	}
}

func TestOverlaysAndNetworksMatchTheManifest(t *testing.T) {
	m, err := manifest.Load()
	if err != nil {
		t.Fatal(err)
	}
	var declared []string
	for _, s := range m.Monitoring.App {
		declared = append(declared, s.Env)
	}
	var networks []string
	for key := range Networks {
		networks = append(networks, key)
	}
	slices.Sort(declared)
	slices.Sort(networks)
	if !slices.Equal(declared, networks) {
		t.Fatalf("overlay networks %v, manifest monitoring.app %v", networks, declared)
	}
	for _, overlay := range Overlays {
		if _, ok := Networks[overlay.Network]; !ok {
			t.Errorf("%s joins undeclared network %s", overlay.File, overlay.Network)
		}
	}
}

func TestSelectDropsOverlaysWhoseNetworkIsMissing(t *testing.T) {
	files := []string{"docker-compose.yaml", operator, projector, traefik, appMetrics, supervisor}
	v := values("OBS_TRAEFIK_METRICS_NETWORK", "custom-traefik")
	run := &infoRunner{networks: []string{Networks["OBS_PROMETHEUS_QUERY_NETWORK"], "custom-traefik"}}
	exists := NetworkExists(context.Background(), run, system.Docker{Docker: []string{"docker"}})

	kept, dropped := Select(files, v, exists)

	if want := []string{"docker-compose.yaml", operator, projector, traefik, supervisor}; !slices.Equal(kept, want) {
		t.Fatalf("kept %v", kept)
	}
	if !slices.Equal(dropped, []string{appMetrics}) {
		t.Fatalf("dropped %v", dropped)
	}
	if !slices.Contains(run.calls, "docker network inspect custom-traefik") {
		t.Fatalf("the network variable chooses the network: %q", run.calls)
	}
}

func TestMayWrite(t *testing.T) {
	cases := []struct {
		current, version string
		want             bool
	}{
		{"", "v3.1.3", true},
		{"", "dev", true},
		{"v3.1.3", "v3.1.3", true},
		{"v3.1.2", "v3.1.3", true},
		{"v3.2.0", "v3.1.9", false},
		{"v3.1.3", "dev", false},
		{"dev", "v3.1.3", true},
		{"dev", "dev", true},
	}
	for _, tc := range cases {
		if got := MayWrite(tc.current, tc.version); got != tc.want {
			t.Errorf("MayWrite(%q, %q) = %v", tc.current, tc.version, got)
		}
	}
}

func TestMountedFilesMatchTheReleaseTool(t *testing.T) {
	script, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "scripts", "observability_release.py"))
	if err != nil {
		t.Skipf("release tool not available: %v", err)
	}
	block := regexp.MustCompile(`(?s)MOUNTED_FILES = \{(.*?)\n\}`).FindSubmatch(script)
	if block == nil {
		t.Fatal("MOUNTED_FILES not found")
	}
	want := map[string]string{}
	for _, match := range regexp.MustCompile(`PREFIX \+ "([^"]+)": "([^"]+)"`).FindAllSubmatch(block[1], -1) {
		want[string(match[1])] = string(match[2])
	}
	if len(want) == 0 || !maps.Equal(MountedFiles, want) {
		t.Fatalf("MountedFiles %v, release tool %v", MountedFiles, want)
	}
}
