package doctor

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/system"
	"github.com/thecrateapp/crate/app/installer/internal/validate"
)

type composeRunner struct{ ps string }

func (r composeRunner) Output(_ context.Context, name string, args ...string) (string, error) {
	if strings.Contains(strings.Join(args, " "), "ps --all --format json") {
		return r.ps, nil
	}
	return "", nil
}

func (composeRunner) Stream(context.Context, io.Writer, string, string, ...string) error { return nil }

func (composeRunner) Run(context.Context, system.Command) error { return nil }

func installAt(t *testing.T, apiURL string, extra map[string]string) string {
	t.Helper()
	m, err := manifest.Load()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	cfg := install.Defaults(dir)
	parsed, _ := url.Parse(apiURL)
	cfg.Ports.API, _ = strconv.Atoi(parsed.Port())
	if err := install.Apply(m, cfg, nil); err != nil {
		t.Fatal(err)
	}
	values, _ := envfile.Read(install.EnvPath(dir))
	for key, value := range extra {
		values.Set(key, value)
	}
	envfile.Write(install.EnvPath(dir), envfile.Render(values, "", nil))
	return dir
}

func deps(ps string, providers *httptest.Server) Deps {
	client := validate.NewClient()
	if providers != nil {
		client.HTTP = providers.Client()
		client.Endpoints.Fanart = providers.URL
	}
	return Deps{
		Run:      composeRunner{ps: ps},
		Validate: client,
		HTTP:     http.DefaultClient,
		DetectDocker: func(context.Context, system.Runner, system.Host) (system.Docker, system.DockerState) {
			return system.Docker{Docker: []string{"docker"}, Compose: []string{"docker", "compose"}, Version: "test"}, system.DockerReady
		},
	}
}

func find(report Report, section, name string) Item {
	for _, item := range report.Items {
		if item.Section == section && item.Name == name {
			return item
		}
	}
	return Item{}
}

func TestDoctorReportsAHealthyInstallation(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer api.Close()
	providers := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer providers.Close()
	dir := installAt(t, api.URL, map[string]string{"FANART_API_KEY": "good"})

	report, err := Run(context.Background(), dir, deps(`{"Service":"crate-api","State":"running","Health":"healthy"}`, providers))
	if err != nil {
		t.Fatal(err)
	}

	for _, want := range []struct{ section, name string }{
		{"Installation", "Secrets"}, {"Services", "crate-api"}, {"Integrations", "Fanart.tv"},
	} {
		if item := find(report, want.section, want.name); item.Status != OK {
			t.Errorf("%s / %s: %+v", want.section, want.name, item)
		}
	}
	if !report.Healthy {
		t.Errorf("a healthy install reported a failure: %+v", report.Items)
	}
	if find(report, "Integrations", "Not set up").Status != Skip {
		t.Error("integrations that are not set up must be listed")
	}
}

func TestDoctorFailsOnStoppedServicesRejectedKeysAndMissingSecrets(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer api.Close()
	providers := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer providers.Close()
	dir := installAt(t, api.URL, map[string]string{"FANART_API_KEY": "bad", "CRATE_CREDENTIAL_KEY": ""})

	report, _ := Run(context.Background(), dir, deps(`{"Service":"crate-worker","State":"exited","Status":"Exited (1)"}`, providers))

	if report.Healthy {
		t.Fatal("the report must not be healthy")
	}
	if item := find(report, "Services", "crate-worker"); item.Status != Fail || !strings.Contains(item.Fix, "logs crate-worker") {
		t.Errorf("stopped worker: %+v", item)
	}
	if item := find(report, "Integrations", "Fanart.tv"); item.Status != Fail || !strings.Contains(item.Fix, "crate configure fanart") {
		t.Errorf("rejected key: %+v", item)
	}
	if item := find(report, "Installation", "Secrets"); item.Status != Warn || !strings.Contains(item.Detail, "CRATE_CREDENTIAL_KEY") {
		t.Errorf("missing secret: %+v", item)
	}
}

func TestDoctorWithoutAnInstallation(t *testing.T) {
	report, err := Run(context.Background(), t.TempDir(), deps("", nil))
	if err != nil || report.Healthy || find(report, "Installation", "Settings").Status != Fail {
		t.Fatalf("got %+v, %v", report, err)
	}
}

func TestReportsPrintForPeopleAndAgents(t *testing.T) {
	report := Report{Healthy: false, Items: []Item{{Section: "API", Name: "http://localhost:8585", Status: Fail, Detail: "no answer"}}}
	var human, machine bytes.Buffer
	Print(&human, report)
	if err := PrintJSON(&machine, report); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(human.String(), "Some checks failed") {
		t.Errorf("human output:\n%s", human.String())
	}
	var decoded Report
	if err := json.Unmarshal(machine.Bytes(), &decoded); err != nil || decoded.Items[0].Status != Fail {
		t.Errorf("json output: %s", machine.String())
	}
}
