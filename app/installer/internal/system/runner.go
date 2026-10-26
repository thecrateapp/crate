// Package system inspects the host and runs the commands the installer needs.
package system

import (
	"bytes"
	"context"
	"io"
	"os/exec"
	"strings"
)

// Runner runs external commands. Tests replace it with a fake.
type Runner interface {
	// Output runs a command and returns its trimmed standard output.
	Output(ctx context.Context, name string, args ...string) (string, error)
	// Stream runs a command, copying its output to w as it happens.
	Stream(ctx context.Context, w io.Writer, dir, name string, args ...string) error
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
