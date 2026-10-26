package copilot

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/system"
	"github.com/thecrateapp/crate/app/installer/internal/validate"
)

type fakeRunner struct{}

func (fakeRunner) Output(context.Context, string, ...string) (string, error) { return "", nil }

func (fakeRunner) Stream(_ context.Context, w io.Writer, _ string, _ string, args ...string) error {
	io.WriteString(w, "compose "+args[len(args)-1]+" done\n")
	return nil
}

const fanartKey = "fanart-secret-value-1234"

type harness struct {
	t      *testing.T
	client *mcp.ClientSession
	dir    string
	api    *httptest.Server
	seen   []string // every tool output, to check for leaked secrets
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	providers := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("api_key") != fanartKey {
			w.WriteHeader(http.StatusUnauthorized)
		}
	}))
	t.Cleanup(providers.Close)
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	t.Cleanup(api.Close)
	client := validate.NewClient()
	client.HTTP = providers.Client()
	client.Endpoints.Fanart = providers.URL
	dir := filepath.Join(t.TempDir(), "crate")
	deps := Deps{
		Run:      fakeRunner{},
		Validate: client,
		HTTP:     http.DefaultClient,
		DetectDocker: func(context.Context, system.Runner, system.Host) (system.Docker, system.DockerState) {
			return system.Docker{Docker: []string{"docker"}, Compose: []string{"docker", "compose"}, Version: "test"}, system.DockerReady
		},
		Getenv: func(key string) string {
			if key == "CRATE_INSTALL_DIR" {
				return dir
			}
			return ""
		},
	}
	server, session, err := NewServer("test", deps)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(session.Close)
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	ctx := context.Background()
	if _, err := server.Connect(ctx, serverTransport, nil); err != nil {
		t.Fatal(err)
	}
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil).Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cs.Close() })
	return &harness{t: t, client: cs, dir: dir, api: api}
}

func (h *harness) call(name string, args map[string]any, out any) *mcp.CallToolResult {
	h.t.Helper()
	result, err := h.client.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		h.t.Fatalf("%s: %v", name, err)
	}
	text := result.Content[0].(*mcp.TextContent).Text
	h.seen = append(h.seen, text)
	if out != nil && !result.IsError {
		if err := json.Unmarshal([]byte(text), out); err != nil {
			h.t.Fatalf("%s: decode %q: %v", name, text, err)
		}
	}
	return result
}

func TestAnAgentInstallsCrateWithoutSeeingSecrets(t *testing.T) {
	h := newHarness(t)

	var status StatusOut
	h.call("crate_status", nil, &status)
	if status.Installed || status.Dir != h.dir || !strings.Contains(strings.Join(status.NextSteps, " "), "where the music is") {
		t.Fatalf("a fresh status must start with questions: %+v", status)
	}

	var basics BasicsOut
	if r := h.call("crate_set_basics", map[string]any{"timezone": "Mars/Olympus"}, nil); !r.IsError {
		t.Fatal("an unknown timezone must be refused")
	}
	h.call("crate_set_basics", map[string]any{"timezone": "Europe/Madrid", "music_dir": filepath.Join(h.dir, "music")}, &basics)
	if basics.Settings.Timezone != "Europe/Madrid" || basics.Library.Exists {
		t.Fatalf("basics: %+v", basics)
	}
	port, _ := strconv.Atoi(strings.TrimPrefix(h.api.URL, "http://127.0.0.1:"))
	h.call("crate_set_access", map[string]any{"mode": "ports", "ports": map[string]any{"http": 80, "https": 443, "api": port, "admin": 8580, "listen": 8581}}, nil)

	if r := h.call("crate_set_integration", map[string]any{"id": "fanart", "enabled": true, "values": map[string]any{"FANART_API_KEY": "x"}}, nil); !r.IsError || !strings.Contains(r.Content[0].(*mcp.TextContent).Text, "crate_request_secrets") {
		t.Fatal("secrets must be refused as plain values")
	}

	var secrets SecretsOut
	h.call("crate_request_secrets", map[string]any{"items": []string{"fanart", "admin_password"}}, &secrets)
	if !strings.HasPrefix(secrets.URL, "http://127.0.0.1:") {
		t.Fatalf("the page must be local: %q", secrets.URL)
	}
	page := get(t, secrets.URL)
	if !strings.Contains(page, "fanart.tv/get-an-api-key") || !strings.Contains(page, `type="password"`) {
		t.Fatalf("the page must guide the user:\n%s", page)
	}
	answer := post(t, secrets.URL, url.Values{"FANART_API_KEY": {fanartKey}, "admin_password": {"listen-to-crate"}})
	if !strings.Contains(answer, "fanart.tv accepted the credentials") || strings.Contains(answer, fanartKey) {
		t.Fatalf("the page must confirm without echoing the key:\n%s", answer)
	}

	h.call("crate_status", nil, &status)
	if fanart := find(status.Integrations, "fanart"); !fanart.Enabled || fanart.Check != "accepted" {
		t.Fatalf("fanart: %+v", fanart)
	}
	if status.Settings.AdminPassword != "chosen by the user" {
		t.Fatalf("admin password: %q", status.Settings.AdminPassword)
	}

	if r := h.call("crate_start", nil, nil); !r.IsError {
		t.Fatal("starting before applying must be refused")
	}
	var applied ApplyOut
	h.call("crate_apply", nil, &applied)
	values, err := envfile.Read(install.EnvPath(h.dir))
	if err != nil {
		t.Fatal(err)
	}
	if key, _ := values.Get("FANART_API_KEY"); key != fanartKey {
		t.Fatal("the key typed in the page must reach .env")
	}

	var progress jobState
	h.call("crate_start", nil, &progress)
	deadline := time.Now().Add(5 * time.Second)
	for progress.Phase != PhaseReady && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
		h.call("crate_progress", nil, &progress)
	}
	if progress.Phase != PhaseReady {
		t.Fatalf("start: %+v", progress)
	}

	var credentials CredentialsOut
	h.call("crate_credentials", nil, &credentials)
	if !strings.Contains(get(t, credentials.URL), "listen-to-crate") {
		t.Fatal("the credentials page must show the admin password to the user")
	}

	for _, output := range h.seen {
		for _, secret := range []string{fanartKey, "listen-to-crate"} {
			if strings.Contains(output, secret) {
				t.Fatalf("a tool output leaked a secret: %s", output)
			}
		}
	}
}

func TestTheSecretPageNeedsItsUnguessableID(t *testing.T) {
	h := newHarness(t)
	var secrets SecretsOut
	h.call("crate_request_secrets", map[string]any{"items": []string{"fanart"}}, &secrets)
	base := secrets.URL[:strings.Index(secrets.URL, "/r/")]

	response, err := http.Get(base + "/r/guess")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("got %d", response.StatusCode)
	}
	if r := h.call("crate_request_secrets", map[string]any{"items": []string{"myspace"}}, nil); !r.IsError {
		t.Fatal("unknown items must be refused")
	}
}

func TestTheAgentGetsToldHowToWork(t *testing.T) {
	h := newHarness(t)
	init := h.client.InitializeResult()
	if !strings.Contains(init.Instructions, "never typed in this chat") {
		t.Fatalf("instructions: %q", init.Instructions)
	}
	tools, err := h.client.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(tools.Tools) != 12 {
		t.Fatalf("got %d tools", len(tools.Tools))
	}
}

func find(states []IntegrationState, id string) IntegrationState {
	for _, state := range states {
		if state.ID == id {
			return state
		}
	}
	return IntegrationState{}
}

func get(t *testing.T, address string) string {
	t.Helper()
	response, err := http.Get(address)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	return string(body)
}

func post(t *testing.T, address string, form url.Values) string {
	t.Helper()
	response, err := http.PostForm(address, form)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	return string(body)
}

func TestAFreshSecretPageShowsNoStatus(t *testing.T) {
	h := newHarness(t)
	var secrets SecretsOut
	h.call("crate_request_secrets", map[string]any{"items": []string{"fanart"}}, &secrets)
	if strings.Contains(get(t, secrets.URL), `class="status`) {
		t.Fatal("nothing was checked yet, so no status may show")
	}
}
