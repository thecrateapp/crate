package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/stack"
	"github.com/thecrateapp/crate/app/installer/internal/system"
)

// Setup runs scripts/agent_setup.py and the agent's own checks for one
// installation. Stack must use the compose files the installation runs now.
type Setup struct {
	Stack  stack.Stack
	Docker []string // ["docker"] or ["sudo", "docker"]
}

// restarted are the services that read the bot, the allowlist and the
// credentials only when they start.
var restarted = map[Mode][]string{
	Agent:    {"crate-agent"},
	Operator: {"crate-operator", "crate-operator-supervisor"},
}

func within(path, parent string) bool {
	relative, err := filepath.Rel(parent, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

// mounts are the host folders the setup writes to, mounted at the same
// path so every path in .env stays valid inside the container.
func mounts(dir string, values *envfile.Values) []string {
	list := []string{dir}
	for _, path := range []string{dataDir(values), get(values, "CRATE_OPERATOR_ROOT")} {
		if path == "" || !filepath.IsAbs(path) {
			continue
		}
		covered := false
		for _, mounted := range list {
			covered = covered || within(path, mounted)
		}
		if !covered {
			list = append(list, path)
		}
	}
	return list
}

func (s Setup) script(ctx context.Context, out io.Writer, values *envfile.Values, mode Mode, env map[string]string, args ...string) error {
	dir := s.Stack.Dir
	run := []string{"run", "--rm", "--no-deps", "-T", "--user", "0:0", "--entrypoint", "python", "--label", "traefik.enable=false"}
	for _, path := range mounts(dir, values) {
		run = append(run, "--volume", path+":"+path)
	}
	names := make([]string, 0, len(env))
	for name, value := range env {
		if value != "" {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	var environment []string
	for _, name := range names {
		run = append(run, "--env", name)
		environment = append(environment, name+"="+env[name])
	}
	run = append(run, "crate-api", filepath.Join(dir, "scripts", "agent_setup.py"))
	run = append(run, args...)
	run = append(run, "--in-container", "--profile", string(mode), "--env-file", install.EnvPath(dir))
	name, full := s.Stack.Command(run...)
	if name == "sudo" && len(names) > 0 {
		full = append([]string{"--preserve-env=" + strings.Join(names, ",")}, full...)
	}
	return setupError(s.Stack.Run.Run(ctx, system.Command{Dir: dir, Name: name, Args: full, Env: environment, Out: out}))
}

// setupError keeps the setup's own explanation, which says what to do.
func setupError(err error) error {
	var failed *system.CommandError
	if errors.As(err, &failed) {
		if message, ok := strings.CutPrefix(failed.Stderr, "Crate Agent setup: "); ok {
			return errors.New(message)
		}
	}
	return err
}

// Init sets mode up with the user's answers (AGENT_* variables). With
// reuse, the bot, allowlist and model keys of the other mode carry over.
func (s Setup) Init(ctx context.Context, out io.Writer, values *envfile.Values, mode Mode, answers map[string]string, reuse bool) error {
	env := map[string]string{"AGENT_SETUP_COMMAND": SetupCommand}
	for name, value := range answers {
		env[name] = strings.TrimSpace(value)
	}
	args := []string{"init", "--non-interactive", "--no-network"}
	if reuse {
		args = append(args, "--reuse")
	}
	return s.script(ctx, out, values, mode, env, args...)
}

// Revoke revokes mode's MCP credentials and deletes its bot and tokens.
func (s Setup) Revoke(ctx context.Context, out io.Writer, values *envfile.Values, mode Mode) error {
	return s.script(ctx, out, values, mode, nil, "revoke")
}

// Transition sets up to, retires from and restarts the stack with the
// compose profile and files of to. Crate must be running.
func (s *Setup) Transition(ctx context.Context, out io.Writer, m *manifest.Manifest, from, to Mode, answers map[string]string) error {
	values, err := install.ReadExisting(s.Stack.Dir)
	if err != nil || values == nil {
		return fmt.Errorf("read the settings: %w", errors.Join(err, errors.New("no .env")))
	}
	if to != Off {
		if err := s.Init(ctx, out, values, to, answers, from != Off && from != to); err != nil {
			return fmt.Errorf("set up %s: %w", to.Name(), err)
		}
	}
	if from != Off && from != to {
		if err := s.Stack.Remove(ctx, out, from.Profile().Compose, from.Profile().Services...); err != nil {
			return fmt.Errorf("stop %s: %w", from.Name(), err)
		}
		if err := s.Revoke(ctx, out, values, from); err != nil {
			return fmt.Errorf("revoke the credential of %s: %w", from.Name(), err)
		}
	}
	if values, err = install.ReadExisting(s.Stack.Dir); err != nil {
		return err
	}
	Activate(values, to)
	if err := envfile.Write(install.EnvPath(s.Stack.Dir), envfile.Render(values, install.EnvHeader, install.Sections(m))); err != nil {
		return err
	}
	s.Stack.Files = install.ComposeFiles(values)
	if err := s.Stack.Up(ctx, out); err != nil {
		return fmt.Errorf("start %s: %w", to.Name(), err)
	}
	if to != Off && from == to {
		return s.Stack.Restart(ctx, out, to.Profile().Compose, restarted[to]...)
	}
	return nil
}

// Status is what the running agent reports about itself.
type Status struct {
	MCP           string
	Ready         bool
	SignInPending bool
}

func containerUser(values *envfile.Values) string {
	uid, gid := get(values, "PUID"), get(values, "PGID")
	if uid == "" || gid == "" {
		return "1000:1000"
	}
	return uid + ":" + gid
}

func (s Setup) exec(ctx context.Context, values *envfile.Values, mode Mode, argv ...string) (string, error) {
	args := append(append([]string(nil), s.Docker[1:]...), "exec", "-u", containerUser(values), mode.Profile().Container)
	return s.Stack.Run.Output(ctx, s.Docker[0], append(args, argv...)...)
}

// Check asks the running agent whether it reaches Crate MCP and has model
// credentials.
func (s Setup) Check(ctx context.Context, values *envfile.Values, mode Mode) (Status, error) {
	out, err := s.exec(ctx, values, mode, "python3", "/opt/crate-hermes/runtime.py", "--check")
	lines := strings.Split(strings.TrimSpace(out), "\n")
	var report struct {
		MCP         string `json:"mcp"`
		Credentials string `json:"model_credentials"`
	}
	if json.Unmarshal([]byte(lines[len(lines)-1]), &report) != nil || report.MCP == "" {
		var failed *system.CommandError
		if errors.As(err, &failed) && failed.Stderr != "" {
			stderr := strings.Split(failed.Stderr, "\n")
			return Status{}, errors.New(strings.TrimSpace(stderr[len(stderr)-1]))
		}
		return Status{}, fmt.Errorf("%s is not running", mode.Profile().Container)
	}
	return Status{
		MCP:           report.MCP,
		Ready:         strings.HasSuffix(report.MCP, " tools"),
		SignInPending: report.Credentials != "" && report.Credentials != "configured",
	}, nil
}

// WaitReady checks until the agent reaches Crate MCP or timeout passes.
func (s Setup) WaitReady(ctx context.Context, values *envfile.Values, mode Mode, timeout, interval time.Duration) (Status, error) {
	deadline := time.Now().Add(timeout)
	for {
		status, err := s.Check(ctx, values, mode)
		if (err == nil && status.Ready) || time.Now().After(deadline) {
			return status, err
		}
		select {
		case <-ctx.Done():
			return status, ctx.Err()
		case <-time.After(interval):
		}
	}
}

// Reply asks the model for one word, the end-to-end proof that the agent works.
func (s Setup) Reply(ctx context.Context, values *envfile.Values, mode Mode) error {
	out, err := s.exec(ctx, values, mode, "hermes", "-z", "Reply with the single word OK.", "-t", "memory")
	if err != nil || strings.TrimSpace(out) == "" {
		return fmt.Errorf("the model did not answer; see `docker compose logs %s`", mode.Profile().Container)
	}
	return nil
}

// SignIn runs the provider's sign-in inside the agent's container, in the
// user's terminal.
func (s Setup) SignIn(ctx context.Context, values *envfile.Values, mode Mode, provider string, stdin io.Reader, out io.Writer) error {
	args := append(append([]string(nil), s.Docker[1:]...), "exec", "-it", "-u", containerUser(values), mode.Profile().Container, "hermes", "auth", "add", provider, "--type", "oauth")
	return s.Stack.Run.Run(ctx, system.Command{Name: s.Docker[0], Args: args, Stdin: stdin, Out: out})
}
