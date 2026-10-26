package wizard

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/system"
	"github.com/thecrateapp/crate/app/installer/internal/validate"
)

type fakeRunner struct{ streamed []string }

func (f *fakeRunner) Output(context.Context, string, ...string) (string, error) { return "", nil }

func (f *fakeRunner) Stream(_ context.Context, _ io.Writer, _ string, name string, args ...string) error {
	f.streamed = append(f.streamed, name+" "+strings.Join(args, " "))
	return nil
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
		validate: validate.NewClient(),
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
