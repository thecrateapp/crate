package stack

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/thecrateapp/crate/app/installer/internal/system"
)

type recordingRunner struct{ calls []string }

func (r *recordingRunner) Output(context.Context, string, ...string) (string, error) { return "", nil }

func (r *recordingRunner) Stream(_ context.Context, _ io.Writer, dir, name string, args ...string) error {
	r.calls = append(r.calls, dir+" $ "+name+" "+strings.Join(args, " "))
	return nil
}

func (r *recordingRunner) Run(_ context.Context, c system.Command) error {
	return r.Stream(context.Background(), nil, c.Dir, c.Name, c.Args...)
}

func TestStackRunsComposeInTheInstallDirectory(t *testing.T) {
	runner := &recordingRunner{}
	s := Stack{Run: runner, Compose: []string{"sudo", "docker", "compose"}, Dir: "/srv/crate"}

	s.Pull(context.Background(), &bytes.Buffer{})
	s.Up(context.Background(), &bytes.Buffer{})

	want := []string{
		"/srv/crate $ sudo docker compose --project-directory /srv/crate -f /srv/crate/docker-compose.yaml --env-file /srv/crate/.env pull",
		"/srv/crate $ sudo docker compose --project-directory /srv/crate -f /srv/crate/docker-compose.yaml --env-file /srv/crate/.env up -d --remove-orphans",
	}
	if strings.Join(runner.calls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("got\n%s", strings.Join(runner.calls, "\n"))
	}
}

func TestTheOperatorOverlayJoinsEveryComposeCall(t *testing.T) {
	bridge := filepath.Join(t.TempDir(), "bridge.sock")
	InfraBridge = bridge
	t.Cleanup(func() { InfraBridge = "/run/crate-infra/bridge.sock" })
	cases := []struct {
		name   string
		files  []string
		bridge bool
		want   string
	}{
		{"stack alone", nil, false, "-f /srv/crate/docker-compose.yaml --env-file /srv/crate/.env up -d --remove-orphans"},
		{"operator without the bridge", []string{"docker-compose.yaml", "deploy/operator/compose.operator.yaml"}, false,
			"-f /srv/crate/docker-compose.yaml -f /srv/crate/deploy/operator/compose.operator.yaml --env-file /srv/crate/.env up -d --remove-orphans --scale crate-infra-relay=0"},
		{"operator with the bridge", []string{"docker-compose.yaml", "deploy/operator/compose.operator.yaml"}, true,
			"-f /srv/crate/docker-compose.yaml -f /srv/crate/deploy/operator/compose.operator.yaml --env-file /srv/crate/.env up -d --remove-orphans"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			os.Remove(bridge)
			if tc.bridge {
				os.WriteFile(bridge, nil, 0o600)
			}
			runner := &recordingRunner{}
			s := Stack{Run: runner, Compose: []string{"docker", "compose"}, Dir: "/srv/crate", Files: tc.files}
			s.Up(context.Background(), &bytes.Buffer{})
			if !strings.HasSuffix(runner.calls[0], tc.want) {
				t.Fatalf("got %s", runner.calls[0])
			}
		})
	}
}

func TestRemoveStopsTheServicesOfAProfile(t *testing.T) {
	runner := &recordingRunner{}
	s := Stack{Run: runner, Compose: []string{"docker", "compose"}, Dir: "/srv/crate"}
	s.Remove(context.Background(), &bytes.Buffer{}, "agent", "crate-agent")
	if !strings.HasSuffix(runner.calls[0], "--env-file /srv/crate/.env --profile agent rm -s -f crate-agent") {
		t.Fatalf("got %s", runner.calls[0])
	}
}

func TestWaitForAPIWaitsUntilCrateAnswers(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/status" || calls.Add(1) < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	err := WaitForAPI(context.Background(), server.Client(), server.URL, time.Second, 5*time.Millisecond)

	if err != nil || calls.Load() != 3 {
		t.Fatalf("err=%v calls=%d", err, calls.Load())
	}
}

func TestWaitForAPIGivesUp(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	if err := WaitForAPI(context.Background(), server.Client(), server.URL, 30*time.Millisecond, 5*time.Millisecond); err == nil {
		t.Fatal("expected a timeout")
	}
}

func TestParseServicesAcceptsBothComposeFormats(t *testing.T) {
	lines := `{"Name":"crate-api","Service":"crate-api","State":"running","Health":"healthy"}
{"Name":"crate-worker","Service":"crate-worker","State":"exited","Health":""}`
	array := `[{"Name":"crate-api","Service":"crate-api","State":"running","Health":"healthy"},{"Name":"crate-worker","Service":"crate-worker","State":"exited","Health":""}]`
	for name, out := range map[string]string{"lines": lines, "array": array} {
		services, err := ParseServices(out)
		if err != nil || len(services) != 2 || services[1].State != "exited" || services[0].Health != "healthy" {
			t.Errorf("%s: got %+v, %v", name, services, err)
		}
	}
	if services, err := ParseServices("  "); err != nil || services != nil {
		t.Errorf("empty output: %+v, %v", services, err)
	}
}

type failingUpRunner struct {
	recordingRunner
	created string
}

func (r *failingUpRunner) Output(_ context.Context, name string, args ...string) (string, error) {
	r.calls = append(r.calls, name+" "+strings.Join(args, " "))
	return r.created, nil
}

func (r *failingUpRunner) Stream(ctx context.Context, w io.Writer, dir, name string, args ...string) error {
	r.recordingRunner.Stream(ctx, w, dir, name, args...)
	if strings.Contains(strings.Join(args, " "), " up -d") {
		return errors.New("compose up failed")
	}
	return nil
}

func TestAFailedUpStartsTheServicesItLeftCreated(t *testing.T) {
	runner := &failingUpRunner{created: "crate-api\ncrate-worker\n"}
	s := Stack{Run: runner, Compose: []string{"docker", "compose"}, Dir: "/srv/crate"}

	err := s.Up(context.Background(), &bytes.Buffer{})

	if err == nil || !strings.Contains(err.Error(), "crate-api, crate-worker") {
		t.Fatalf("error = %v", err)
	}
	calls := strings.Join(runner.calls, "\n")
	if !strings.Contains(calls, "ps --all --status created --format {{.Service}}") {
		t.Fatalf("created services were not listed:\n%s", calls)
	}
	if !strings.HasSuffix(calls, "start crate-api crate-worker") {
		t.Fatalf("created services were not started:\n%s", calls)
	}
}

func TestAFailedUpWithNothingCreatedReturnsTheOriginalError(t *testing.T) {
	runner := &failingUpRunner{}
	s := Stack{Run: runner, Compose: []string{"docker", "compose"}, Dir: "/srv/crate"}

	err := s.Up(context.Background(), &bytes.Buffer{})

	if err == nil || err.Error() != "compose up failed" {
		t.Fatalf("error = %v", err)
	}
}
