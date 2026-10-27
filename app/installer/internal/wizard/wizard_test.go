package wizard

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/system"
	"github.com/thecrateapp/crate/app/installer/internal/validate"
)

type fakeRunner struct {
	streamed []string
	commands []system.Command
	outputs  map[string]string // argument substring -> output
}

func (f *fakeRunner) Output(_ context.Context, name string, args ...string) (string, error) {
	line := name + " " + strings.Join(args, " ")
	for match, output := range f.outputs {
		if strings.Contains(line, match) {
			return output, nil
		}
	}
	return "", nil
}

func (f *fakeRunner) Stream(_ context.Context, _ io.Writer, _ string, name string, args ...string) error {
	f.streamed = append(f.streamed, name+" "+strings.Join(args, " "))
	return nil
}

func (f *fakeRunner) Run(_ context.Context, c system.Command) error {
	f.streamed = append(f.streamed, c.Name+" "+strings.Join(c.Args, " "))
	f.commands = append(f.commands, c)
	return nil
}

// offlineValidation fails fast instead of calling real providers.
func offlineValidation() validate.Client {
	client := validate.NewClient()
	client.HTTP = &http.Client{Timeout: time.Second}
	dead := "http://127.0.0.1:1"
	client.Endpoints = validate.Endpoints{
		LastFM: dead, Fanart: dead, SpotifyAuth: dead, Discogs: dead, Setlistfm: dead,
		Ticketmaster: dead, Gemini: dead, OpenAI: dead, Anthropic: dead, Telegram: dead,
	}
	return client
}

func newTestWizard(t *testing.T, opts Options) (*wizard, *bytes.Buffer, *fakeRunner) {
	t.Helper()
	m, err := manifest.Load()
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	runner := &fakeRunner{}
	return &wizard{
		opts:     opts,
		out:      &out,
		run:      runner,
		validate: offlineValidation(),
		manifest: m,
		detectDocker: func(context.Context, system.Runner, system.Host) (system.Docker, system.DockerState) {
			return system.Docker{Docker: []string{"docker"}, Compose: []string{"docker", "compose"}, Version: "test"}, system.DockerReady
		},
		startupTimeout: 50 * time.Millisecond,
	}, &out, runner
}

func TestUnattendedInstallWritesFilesWithoutStarting(t *testing.T) {
	dir := t.TempDir()
	w, out, runner := newTestWizard(t, Options{Version: "test", InstallDir: dir, Yes: true, SkipStart: true})

	if err := w.execute(context.Background()); err != nil {
		t.Fatalf("%v\n%s", err, out.String())
	}

	values, err := envfile.Read(install.EnvPath(dir))
	if err != nil {
		t.Fatal(err)
	}
	if password, _ := values.Get("DEFAULT_ADMIN_PASSWORD"); password == "" || password != w.cfg.AdminPassword {
		t.Error("the generated admin password must be written")
	}
	if !strings.Contains(out.String(), "Files are ready") {
		t.Errorf("missing the skip-start message:\n%s", out.String())
	}
	if len(runner.streamed) != 0 {
		t.Errorf("no command should run in ports mode without starting: %v", runner.streamed)
	}
}

func TestUnattendedInstallStartsTheStack(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CRATE_API_PORT", "1")
	w, out, runner := newTestWizard(t, Options{Version: "test", InstallDir: dir, Yes: true})

	err := w.execute(context.Background())

	streamed := strings.Join(runner.streamed, "\n")
	if !strings.Contains(streamed, "compose --project-directory "+dir) || !strings.Contains(streamed, " pull") || !strings.Contains(streamed, " up -d") {
		t.Fatalf("compose was not run:\n%s", streamed)
	}
	if err == nil || !strings.Contains(out.String(), "docker compose logs -f crate-api") {
		t.Fatalf("a Crate that never answers must point at its logs:\n%s", out.String())
	}
}

func TestDryRunWritesNothing(t *testing.T) {
	dir := t.TempDir() + "/crate"
	w, out, _ := newTestWizard(t, Options{Version: "test", InstallDir: dir, Yes: true, DryRun: true})

	if err := w.execute(context.Background()); err != nil {
		t.Fatalf("%v\n%s", err, out.String())
	}
	if values, _ := install.ReadExisting(dir); values != nil {
		t.Error("a dry run wrote .env")
	}
}

func TestUnattendedInstallTakesIntegrationsFromTheEnvironment(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("FANART_API_KEY", "from-env")
	t.Setenv("SLSKD_URL", "http://slskd:5030")
	t.Setenv("SLSKD_SLSK_USERNAME", "crate-listener")
	t.Setenv("SLSKD_SLSK_PASSWORD", "secret")
	w, out, _ := newTestWizard(t, Options{Version: "test", InstallDir: dir, Yes: true, SkipStart: true})

	if err := w.execute(context.Background()); err != nil {
		t.Fatalf("%v\n%s", err, out.String())
	}

	values, _ := envfile.Read(install.EnvPath(dir))
	for key, want := range map[string]string{"FANART_API_KEY": "from-env", "COMPOSE_PROFILES": "soulseek", "SLSKD_SLSK_USERNAME": "crate-listener"} {
		if got, _ := values.Get(key); got != want {
			t.Errorf("%s = %q, want %q", key, got, want)
		}
	}
	if key, _ := values.Get("SLSKD_API_KEY"); key == "" {
		t.Error("Crate's slskd needs a generated API key")
	}
	if !strings.Contains(out.String(), "Fanart.tv") || !strings.Contains(out.String(), "Soulseek") {
		t.Errorf("configured integrations must be reported:\n%s", out.String())
	}
}

func TestConfigureNeedsAnInstallationAndKnownIntegrations(t *testing.T) {
	w, _, _ := newTestWizard(t, Options{Version: "test", InstallDir: t.TempDir()})
	if err := w.configure(context.Background(), []string{"lastfm"}); err == nil || !strings.Contains(err.Error(), "crate install") {
		t.Fatalf("got %v", err)
	}

	dir := t.TempDir()
	if err := install.Apply(w.manifest, install.Defaults(dir), nil); err != nil {
		t.Fatal(err)
	}
	w, _, _ = newTestWizard(t, Options{Version: "test", InstallDir: dir})
	err := w.configure(context.Background(), []string{"myspace"})
	if err == nil || !strings.Contains(err.Error(), "lastfm") {
		t.Fatalf("an unknown id must list the valid ones, got %v", err)
	}
}

func TestTurningSoulseekOffRemovesItsProfile(t *testing.T) {
	w, _, _ := newTestWizard(t, Options{})
	w.existing = envfile.New()
	w.existing.Set("COMPOSE_PROFILES", "soulseek,extra")
	in, _ := w.manifest.Integration("soulseek")

	w.clear(in)

	if strings.Join(w.cfg.Profiles, ",") != "extra" {
		t.Fatalf("profiles %v", w.cfg.Profiles)
	}
	if value, ok := w.cfg.Integrations["SLSKD_URL"]; !ok || value != "" {
		t.Fatal("its variables must be cleared")
	}
}

func TestInstallPinsTheImagesOfItsRelease(t *testing.T) {
	cases := []struct {
		name, version, existing, override, want string
	}{
		{name: "new install", version: "v3.1.0", want: "v3.1.0"},
		{name: "development build", version: "dev", want: "latest"},
		{name: "upgrade from latest", version: "v3.1.0", existing: "latest", want: "v3.1.0"},
		{name: "upgrade from an older release", version: "v3.1.0", existing: "v3.0.0", want: "v3.1.0"},
		{name: "older installer", version: "v3.0.0", existing: "v3.1.0", want: "v3.1.0"},
		{name: "custom tag", version: "v3.1.0", existing: "2734413f2a1b", want: "2734413f2a1b"},
		{name: "environment override", version: "v3.1.0", existing: "v3.0.0", override: "latest", want: "latest"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			w, out, _ := newTestWizard(t, Options{Version: tc.version, InstallDir: dir, Yes: true, SkipStart: true})
			if tc.existing != "" {
				cfg := install.Defaults(dir)
				cfg.ImageTag = tc.existing
				if err := install.Apply(w.manifest, cfg, nil); err != nil {
					t.Fatal(err)
				}
			}
			t.Setenv("CRATE_IMAGE_TAG", tc.override)

			if err := w.execute(context.Background()); err != nil {
				t.Fatalf("%v\n%s", err, out.String())
			}

			values, _ := envfile.Read(install.EnvPath(dir))
			if got, _ := values.Get("CRATE_IMAGE_TAG"); got != tc.want {
				t.Fatalf("CRATE_IMAGE_TAG = %q, want %q", got, tc.want)
			}
		})
	}
}
