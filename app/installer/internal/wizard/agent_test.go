package wizard

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"testing"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/stack"
	"github.com/thecrateapp/crate/app/installer/internal/system"
)

const testBot = "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

func runningAPI(t *testing.T) string {
	t.Helper()
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	t.Cleanup(api.Close)
	parsed, _ := url.Parse(api.URL)
	return parsed.Port()
}

func TestUnattendedInstallSetsUpCrateAgent(t *testing.T) {
	cases := []struct {
		name   string
		check  string
		output []string
	}{
		{"ready", `{"mcp": "12 tools", "model_credentials": "configured"}`, []string{"Crate Agent is running and answered", "Message your bot on Telegram"}},
		{"sign-in pending", `{"mcp": "12 tools", "model_credentials": "provider openai-codex has no login"}`, []string{"Sign-in pending: run `crate configure agent`", "Sign in to ChatGPT"}},
		{"cannot reach crate", `{"mcp": "unreachable or rejected; check the credential and MCP flags"}`, []string{"Crate Agent cannot use Crate yet", "crate doctor"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			t.Setenv("CRATE_API_PORT", runningAPI(t))
			t.Setenv("CRATE_AGENT_MODE", "agent")
			t.Setenv("AGENT_TELEGRAM_TOKEN", testBot)
			t.Setenv("AGENT_ALLOWED_USERS", "12345678")
			w, out, runner := newTestWizard(t, Options{Version: "test", InstallDir: dir, Yes: true})
			runner.outputs = map[string]string{"runtime.py --check": tc.check, "hermes -z": "OK"}

			if err := w.execute(context.Background()); err != nil {
				t.Fatalf("%v\n%s", err, out.String())
			}

			setup := slices.IndexFunc(runner.commands, func(c system.Command) bool { return strings.Contains(strings.Join(c.Args, " "), "agent_setup.py init") })
			if setup < 0 {
				t.Fatalf("the setup did not run:\n%s", strings.Join(runner.streamed, "\n"))
			}
			command := runner.commands[setup]
			if strings.Contains(strings.Join(command.Args, " "), testBot) || !slices.Contains(command.Env, "AGENT_TELEGRAM_TOKEN="+testBot) {
				t.Fatal("the bot token must travel in the environment, not the arguments")
			}
			values, _ := envfile.Read(install.EnvPath(dir))
			profiles, _ := values.Get("COMPOSE_PROFILES")
			if _, leaked := values.Get("AGENT_TELEGRAM_TOKEN"); leaked || profiles != "agent" {
				t.Fatalf("profiles %q, token in .env %v", profiles, leaked)
			}
			for _, want := range tc.output {
				if !strings.Contains(out.String(), want) {
					t.Errorf("missing %q in\n%s", want, out.String())
				}
			}
		})
	}
}

func TestInstallLeavesCrateOperatorToConfigure(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CRATE_AGENT_MODE", "operator")
	w, out, _ := newTestWizard(t, Options{Version: "test", InstallDir: dir, Yes: true, SkipStart: true})

	if err := w.execute(context.Background()); err != nil {
		t.Fatalf("%v\n%s", err, out.String())
	}

	values, _ := envfile.Read(install.EnvPath(dir))
	if mode, _ := values.Get("CRATE_AGENT_MODE"); mode != "agent" {
		t.Fatalf("mode %q", mode)
	}
	for _, want := range []string{"Crate Operator is set up with `crate configure agent`", "Then set up Crate Agent with `crate configure agent`"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("missing %q in\n%s", want, out.String())
		}
	}
}

func TestTurningTheAgentOffRetiresIt(t *testing.T) {
	dir := t.TempDir()
	w, out, runner := newTestWizard(t, Options{Version: "test", InstallDir: dir})
	cfg := install.Defaults(dir)
	cfg.Integrations = map[string]string{"CRATE_AGENT_MODE": ""}
	if err := install.Apply(w.manifest, cfg, nil); err != nil {
		t.Fatal(err)
	}
	values, _ := install.ReadExisting(dir)
	values.Set("COMPOSE_PROFILES", "agent,soulseek")
	envfile.Write(install.EnvPath(dir), envfile.Render(values, "", nil))
	w.docker.Docker, w.docker.Compose = []string{"docker"}, []string{"docker", "compose"}

	w.setUpAgent(context.Background(), stack.Stack{Run: runner, Compose: w.docker.Compose, Dir: dir}, "http://127.0.0.1:1")

	calls := strings.Join(runner.streamed, "\n")
	for _, want := range []string{"--profile agent rm -s -f crate-agent", "agent_setup.py revoke", "up -d --remove-orphans"} {
		if !strings.Contains(calls, want) {
			t.Errorf("missing %q in\n%s", want, calls)
		}
	}
	values, _ = install.ReadExisting(dir)
	if profiles, _ := values.Get("COMPOSE_PROFILES"); profiles != "soulseek" {
		t.Fatalf("profiles %q", profiles)
	}
	if !strings.Contains(out.String(), "Crate Agent is off") {
		t.Fatalf("output:\n%s", out.String())
	}
}

func TestConfigureKnowsTheAgentByItsOldNameAndWhenItIsPending(t *testing.T) {
	w, _, _ := newTestWizard(t, Options{})
	if in, ok := w.integration("telegram"); !ok || in.ID != "agent" {
		t.Fatalf("telegram must open the agent, got %q", in.ID)
	}
	cases := []struct {
		mode, profiles string
		nothing        bool
	}{
		{"", "", true},
		{"agent", "agent", true},
		{"agent", "", false},
		{"", "agent", false},
		{"operator", "agent", false},
	}
	for _, tc := range cases {
		w.existing = envfile.New()
		w.existing.Set("CRATE_AGENT_MODE", tc.mode)
		w.existing.Set("COMPOSE_PROFILES", tc.profiles)
		if got := w.nothingToApply(); got != tc.nothing {
			t.Errorf("mode %q profiles %q: nothing to apply %v", tc.mode, tc.profiles, got)
		}
	}
}
