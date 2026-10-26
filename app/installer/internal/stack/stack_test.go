package stack

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type recordingRunner struct{ calls []string }

func (r *recordingRunner) Output(context.Context, string, ...string) (string, error) { return "", nil }

func (r *recordingRunner) Stream(_ context.Context, _ io.Writer, dir, name string, args ...string) error {
	r.calls = append(r.calls, dir+" $ "+name+" "+strings.Join(args, " "))
	return nil
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
