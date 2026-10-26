package agent

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/stack"
	"github.com/thecrateapp/crate/app/installer/internal/system"
)

type recorder struct {
	commands []system.Command
	output   string
	err      error
}

func (r *recorder) Output(_ context.Context, name string, args ...string) (string, error) {
	r.commands = append(r.commands, system.Command{Name: name, Args: args})
	return r.output, r.err
}

func (r *recorder) Stream(_ context.Context, _ io.Writer, dir, name string, args ...string) error {
	r.commands = append(r.commands, system.Command{Dir: dir, Name: name, Args: args})
	return nil
}

func (r *recorder) Run(_ context.Context, c system.Command) error {
	r.commands = append(r.commands, c)
	return r.err
}

func (r *recorder) lines() []string {
	var lines []string
	for _, c := range r.commands {
		lines = append(lines, c.Name+" "+strings.Join(c.Args, " "))
	}
	return lines
}

func newSetup(dir string, compose []string, runner system.Runner) *Setup {
	return &Setup{Stack: stack.Stack{Run: runner, Compose: compose, Dir: dir}, Docker: compose[:len(compose)-1]}
}

func TestInitRunsTheSetupInACrateAPIContainer(t *testing.T) {
	data := t.TempDir()
	values := settings("DATA_DIR", data, "CRATE_OPERATOR_ROOT", "/srv/operator")
	answers := map[string]string{"AGENT_TELEGRAM_TOKEN": "123:bot-secret", "AGENT_MODEL_API_KEY": "sk-secret", "AGENT_ALLOWED_USERS": ""}
	cases := []struct {
		name    string
		compose []string
		reuse   bool
		prefix  string
	}{
		{"docker", []string{"docker", "compose"}, false, "docker compose --project-directory /srv/crate"},
		{"sudo", []string{"sudo", "docker", "compose"}, true, "sudo --preserve-env=AGENT_MODEL_API_KEY,AGENT_SETUP_COMMAND,AGENT_TELEGRAM_TOKEN docker compose"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			runner := &recorder{}
			if err := newSetup("/srv/crate", tc.compose, runner).Init(context.Background(), io.Discard, values, Operator, answers, tc.reuse); err != nil {
				t.Fatal(err)
			}
			c := runner.commands[0]
			line := runner.lines()[0]
			for _, want := range []string{
				tc.prefix,
				" run --rm --no-deps -T --user 0:0 --entrypoint python --label traefik.enable=false",
				" --volume /srv/crate:/srv/crate --volume " + data + ":" + data + " --volume /srv/operator:/srv/operator",
				" --env AGENT_MODEL_API_KEY --env AGENT_SETUP_COMMAND --env AGENT_TELEGRAM_TOKEN crate-api /srv/crate/scripts/agent_setup.py init --non-interactive --no-network",
				" --in-container --profile operator --env-file /srv/crate/.env",
			} {
				if !strings.Contains(line, want) {
					t.Errorf("missing %q in\n%s", want, line)
				}
			}
			if strings.Contains(line, "--reuse") != tc.reuse {
				t.Errorf("reuse %v: %s", tc.reuse, line)
			}
			if strings.Contains(line, "secret") || strings.Contains(line, "AGENT_ALLOWED_USERS") {
				t.Errorf("secrets or empty answers reached the arguments: %s", line)
			}
			for _, want := range []string{"AGENT_TELEGRAM_TOKEN=123:bot-secret", "AGENT_MODEL_API_KEY=sk-secret", "AGENT_SETUP_COMMAND=crate configure agent"} {
				if !slices.Contains(c.Env, want) {
					t.Errorf("environment lacks %s: %v", want, c.Env)
				}
			}
		})
	}
}

func TestMountsSkipFoldersInsideTheInstallation(t *testing.T) {
	values := settings("DATA_DIR", "/srv/crate/data", "CRATE_OPERATOR_ROOT", "/srv/crate/data/op")
	if got := mounts("/srv/crate", values); len(got) != 1 {
		t.Fatalf("got %v", got)
	}
	if got := mounts("/srv/crate", settings("DATA_DIR", "/srv/crate-data")); len(got) != 2 {
		t.Fatalf("a sibling folder is not inside: %v", got)
	}
}

func TestTransitionMovesBetweenModes(t *testing.T) {
	m, err := manifest.Load()
	if err != nil {
		t.Fatal(err)
	}
	overlay := "docker-compose.yaml:deploy/operator/compose.operator.yaml"
	cases := []struct {
		name            string
		profiles, files string
		from, to        Mode
		answers         map[string]string
		calls           []string
		wantProfiles    string
		wantFiles       string
	}{
		{"agent on", "", "", Off, Agent, map[string]string{"AGENT_TELEGRAM_TOKEN": "t"},
			[]string{"agent_setup.py init", "up -d --remove-orphans"}, "agent", ""},
		{"agent to operator", "agent", "", Agent, Operator, nil,
			[]string{"agent_setup.py init --non-interactive --no-network --reuse --in-container --profile operator", "--profile agent rm -s -f crate-agent", "agent_setup.py revoke --in-container --profile agent", "compose.operator.yaml --env-file /ENV up -d --remove-orphans"}, "crate-operator", overlay},
		{"operator off", "crate-operator", overlay, Operator, Off, nil,
			[]string{"compose.operator.yaml --env-file /ENV --profile crate-operator rm -s -f crate-operator crate-infra-relay", "compose.operator.yaml --env-file /ENV run && revoke --in-container --profile operator", "docker-compose.yaml --env-file /ENV up -d --remove-orphans"}, "", ""},
		{"new bot", "agent", "", Agent, Agent, map[string]string{"AGENT_TELEGRAM_TOKEN": "t"},
			[]string{"agent_setup.py init", "up -d --remove-orphans", "--profile agent restart crate-agent"}, "agent", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			values := settings("DATA_DIR", filepath.Join(dir, "data"), "COMPOSE_PROFILES", tc.profiles)
			if tc.files != "" {
				values.Set("COMPOSE_FILE", tc.files)
			}
			envfile.Write(install.EnvPath(dir), envfile.Render(values, "", nil))
			runner := &recorder{}
			setup := newSetup(dir, []string{"docker", "compose"}, runner)
			setup.Stack.Files = install.ComposeFiles(values)
			if err := setup.Transition(context.Background(), io.Discard, m, tc.from, tc.to, tc.answers); err != nil {
				t.Fatal(err)
			}
			lines := runner.lines()
			if len(lines) != len(tc.calls) {
				t.Fatalf("calls:\n%s", strings.Join(lines, "\n"))
			}
			for i, wants := range tc.calls {
				for _, want := range strings.Split(strings.ReplaceAll(wants, "/ENV", install.EnvPath(dir)), " && ") {
					if !strings.Contains(lines[i], want) {
						t.Errorf("call %d: want %q in\n%s", i, want, lines[i])
					}
				}
			}
			written, _ := install.ReadExisting(dir)
			profiles, _ := written.Get("COMPOSE_PROFILES")
			files, _ := written.Get("COMPOSE_FILE")
			if profiles != tc.wantProfiles || files != tc.wantFiles {
				t.Fatalf("profiles %q files %q", profiles, files)
			}
			if _, err := os.Stat(install.EnvPath(dir)); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCheckReadsTheAgentReport(t *testing.T) {
	cases := []struct {
		name   string
		output string
		err    error
		want   Status
		fails  string
	}{
		{"ready", `{"profile": "agent", "mcp": "12 tools", "model_credentials": "configured"}`, nil, Status{MCP: "12 tools", Ready: true}, ""},
		{"sign-in pending", `{"mcp": "12 tools", "model_credentials": "provider openai-codex has no login"}`, errors.New("exit 1"), Status{MCP: "12 tools", Ready: true, SignInPending: true}, ""},
		{"mcp rejected", `{"mcp": "unreachable or rejected; check the credential and MCP flags", "model_credentials": "configured"}`, errors.New("exit 1"), Status{MCP: "unreachable or rejected; check the credential and MCP flags"}, ""},
		{"blocked", "", &system.CommandError{Command: "docker", Stderr: "Crate Agent startup blocked: Dedicated agent secrets are missing."}, Status{}, "secrets are missing"},
		{"not running", "", errors.New("no such container"), Status{}, "crate-agent is not running"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			runner := &recorder{output: tc.output, err: tc.err}
			got, err := newSetup("/srv/crate", []string{"docker", "compose"}, runner).Check(context.Background(), settings("PUID", "1001", "PGID", "1002"), Agent)
			if tc.fails != "" {
				if err == nil || !strings.Contains(err.Error(), tc.fails) {
					t.Fatalf("got %v", err)
				}
				return
			}
			if err != nil || got != tc.want {
				t.Fatalf("got %+v, %v", got, err)
			}
			if line := runner.lines()[0]; line != "docker exec -u 1001:1002 crate-agent python3 /opt/crate-hermes/runtime.py --check" {
				t.Fatalf("ran %s", line)
			}
		})
	}
}

func TestSignInRunsInTheAgentContainer(t *testing.T) {
	runner := &recorder{}
	setup := newSetup("/srv/crate", []string{"sudo", "docker", "compose"}, runner)
	setup.SignIn(context.Background(), settings("PUID", "1000", "PGID", "1000"), Operator, "openai-codex", os.Stdin, io.Discard)
	if got := runner.lines()[0]; got != "sudo docker exec -it -u 1000:1000 crate-operator hermes auth add openai-codex --type oauth" {
		t.Fatalf("got %s", got)
	}
	if runner.commands[0].Stdin == nil {
		t.Fatal("the sign-in needs the terminal")
	}
}

type sequence struct {
	recorder
	outputs []string
}

func (s *sequence) Output(ctx context.Context, name string, args ...string) (string, error) {
	s.recorder.Output(ctx, name, args...)
	next := s.outputs[0]
	if len(s.outputs) > 1 {
		s.outputs = s.outputs[1:]
	}
	return next, nil
}

func TestWaitReadyRetriesUntilTheAgentReachesCrate(t *testing.T) {
	runner := &sequence{outputs: []string{
		`{"mcp": "unreachable or rejected; check the credential and MCP flags"}`,
		`{"mcp": "12 tools", "model_credentials": "configured"}`,
	}}
	status, err := newSetup("/srv/crate", []string{"docker", "compose"}, runner).WaitReady(context.Background(), settings(), Agent, time.Second, time.Millisecond)
	if err != nil || !status.Ready || len(runner.commands) != 2 {
		t.Fatalf("status %+v, err %v, %d checks", status, err, len(runner.commands))
	}
}

func TestReplyNeedsAnAnswerFromTheModel(t *testing.T) {
	cases := []struct {
		output string
		ok     bool
	}{
		{"OK", true},
		{"", false},
	}
	for _, tc := range cases {
		err := newSetup("/srv/crate", []string{"docker", "compose"}, &recorder{output: tc.output}).Reply(context.Background(), settings(), Agent)
		if (err == nil) != tc.ok {
			t.Errorf("%q: %v", tc.output, err)
		}
	}
}

func TestTheSetupsOwnMessageReachesTheUser(t *testing.T) {
	m, err := manifest.Load()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	envfile.Write(install.EnvPath(dir), envfile.Render(settings("DATA_DIR", dir), "", nil))
	unsupported := "This Crate version does not support Crate Agent yet. Update Crate (run `crate install` again to download the latest images), then run `crate configure agent`"
	cases := []struct {
		err  error
		want string
	}{
		{&system.CommandError{Command: "docker", Stderr: "Crate Agent setup: " + unsupported}, "set up Crate Agent: " + unsupported},
		{&system.CommandError{Command: "docker", Stderr: "no such service: crate-api"}, "set up Crate Agent: docker: no such service: crate-api"},
	}
	for _, tc := range cases {
		setup := newSetup(dir, []string{"docker", "compose"}, &recorder{err: tc.err})
		err := setup.Transition(context.Background(), io.Discard, m, Off, Agent, nil)
		if err == nil || err.Error() != tc.want {
			t.Errorf("got %v", err)
		}
	}
}
