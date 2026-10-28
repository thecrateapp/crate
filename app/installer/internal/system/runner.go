// Package system inspects the host and runs the commands the installer needs.
package system

import (
	"bytes"
	"context"
	"io"
	"os"
	"os/exec"
	"strings"
)

// Runner runs external commands. Tests replace it with a fake.
type Runner interface {
	// Output runs a command and returns its trimmed standard output.
	Output(ctx context.Context, name string, args ...string) (string, error)
	// Stream runs a command, copying its output to w as it happens.
	Stream(ctx context.Context, w io.Writer, dir, name string, args ...string) error
	// Run runs c with the installer's environment plus c.Env.
	Run(ctx context.Context, c Command) error
}

// Command is a process with its own environment, input and output. Secrets
// go in Env, never in Args, so they do not show in the process list.
type Command struct {
	Dir   string
	Name  string
	Args  []string
	Env   []string
	Stdin io.Reader
	Out   io.Writer
}

// ExecRunner runs real commands. Stdin is handed to streamed commands so
// sudo can ask for a password; leave it nil when stdin carries something
// else, such as the MCP protocol.
type ExecRunner struct {
	Stdin io.Reader
}

func (r ExecRunner) Output(ctx context.Context, name string, args ...string) (string, error) {
	var stdout, stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return strings.TrimSpace(stdout.String()), &CommandError{Command: name, Err: err, Stderr: strings.TrimSpace(stderr.String())}
	}
	return strings.TrimSpace(stdout.String()), nil
}

func (r ExecRunner) Stream(ctx context.Context, w io.Writer, dir, name string, args ...string) error {
	var stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Stdin = r.Stdin
	cmd.Stdout = w
	cmd.Stderr = io.MultiWriter(w, &stderr)
	if err := cmd.Run(); err != nil {
		return &CommandError{Command: name, Err: err, Stderr: strings.TrimSpace(stderr.String())}
	}
	return nil
}

func (r ExecRunner) Run(ctx context.Context, c Command) error {
	var stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, c.Name, c.Args...)
	cmd.Dir = c.Dir
	cmd.Env = append(os.Environ(), c.Env...)
	cmd.Stdin = c.Stdin
	out := c.Out
	if out == nil {
		out = io.Discard
	}
	if terminal, ok := out.(*os.File); ok {
		cmd.Stdout, cmd.Stderr = terminal, terminal
	} else {
		cmd.Stdout, cmd.Stderr = out, io.MultiWriter(out, &stderr)
	}
	if err := cmd.Run(); err != nil {
		return &CommandError{Command: c.Name, Err: err, Stderr: lastLine(stderr.String())}
	}
	return nil
}

func lastLine(text string) string {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}

type CommandError struct {
	Command string
	Err     error
	Stderr  string
}

func (e *CommandError) Error() string {
	if e.Stderr != "" {
		return e.Command + ": " + e.Stderr
	}
	return e.Command + ": " + e.Err.Error()
}

func (e *CommandError) Unwrap() error { return e.Err }
