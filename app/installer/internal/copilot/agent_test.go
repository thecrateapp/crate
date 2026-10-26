package copilot

import (
	"context"
	"io"
	"strings"
	"testing"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/stack"
	"github.com/thecrateapp/crate/app/installer/internal/system"
)

type signInRunner struct{ fakeRunner }

func (signInRunner) Output(context.Context, string, ...string) (string, error) {
	return `{"mcp": "12 tools", "model_credentials": "provider openai-codex has no login"}`, nil
}

func TestASignInPendingIsToldToTheUser(t *testing.T) {
	m, err := manifest.Load()
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	cfg := install.Defaults(dir)
	cfg.Integrations = map[string]string{"CRATE_AGENT_MODE": "agent"}
	if err := install.Apply(m, cfg, nil); err != nil {
		t.Fatal(err)
	}
	values, _ := install.ReadExisting(dir)
	s := NewSession(m, Deps{})
	s.cfg.Integrations = map[string]string{"AGENT_TELEGRAM_TOKEN": "123:abc"}
	run := signInRunner{}
	step := s.agentStep(stack.Stack{Run: run, Compose: []string{"docker", "compose"}, Dir: dir}, system.Docker{Docker: []string{"docker"}}, values)
	if step == nil {
		t.Fatal("a new agent must be set up")
	}
	state := step(context.Background(), io.Discard)
	if state != "Sign-in pending: run `crate configure agent` in a terminal (Sign in to ChatGPT)" {
		t.Fatalf("state %q", state)
	}
	steps := strings.Join(s.nextSteps(StatusOut{Applied: true, Start: &jobState{Phase: PhaseReady, Agent: state}}, system.DockerReady), " ")
	if !strings.Contains(steps, "Sign-in pending: run `crate configure agent`") {
		t.Fatalf("next steps: %s", steps)
	}
}

func TestNothingToDoForAnAgentThatRunsAsAsked(t *testing.T) {
	m, _ := manifest.Load()
	s := NewSession(m, Deps{})
	cases := []struct {
		mode, profiles string
		answers        map[string]string
		step           bool
	}{
		{"", "", nil, false},
		{"agent", "agent", nil, false},
		{"agent", "agent", map[string]string{"AGENT_ALLOWED_USERS": "1"}, true},
		{"agent", "", nil, true},
		{"", "agent", nil, true},
	}
	for _, tc := range cases {
		env := envValues("CRATE_AGENT_MODE", tc.mode, "COMPOSE_PROFILES", tc.profiles)
		s.cfg.Integrations = tc.answers
		if got := s.agentStep(stack.Stack{}, system.Docker{}, env) != nil; got != tc.step {
			t.Errorf("%+v: step %v", tc, got)
		}
	}
}

func envValues(pairs ...string) *envfile.Values {
	values := envfile.New()
	for i := 0; i+1 < len(pairs); i += 2 {
		values.Set(pairs[i], pairs[i+1])
	}
	return values
}
