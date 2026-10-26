// Package wizard is the interactive `crate install` flow.
package wizard

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/charmbracelet/huh"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/system"
	"github.com/thecrateapp/crate/app/installer/internal/ui"
	"github.com/thecrateapp/crate/app/installer/internal/validate"
)

type Options struct {
	Version    string
	InstallDir string
	Yes        bool // accept defaults and environment overrides; never prompt
	DryRun     bool // show the plan, write nothing
	SkipStart  bool // write the files, do not start containers
	Accessible bool // plain prompts for screen readers
}

// ErrCancelled is returned when the user leaves the wizard.
var ErrCancelled = errors.New("installation cancelled")

const totalSteps = 6

type wizard struct {
	opts     Options
	out      io.Writer
	run      system.Runner
	validate validate.Client
	manifest *manifest.Manifest

	detectDocker   func(context.Context, system.Runner, system.Host) (system.Docker, system.DockerState)
	startupTimeout time.Duration

	host     system.Host
	docker   system.Docker
	cfg      install.Config
	existing *envfile.Values
}

func Run(ctx context.Context, opts Options) error {
	m, err := manifest.Load()
	if err != nil {
		return err
	}
	if !opts.Yes && !ui.IsTerminal(os.Stdin) {
		return fmt.Errorf("no terminal to ask questions on; run `crate install` in a terminal or pass --yes")
	}
	w := &wizard{
		opts:           opts,
		out:            os.Stdout,
		run:            system.ExecRunner{},
		validate:       validate.NewClient(),
		manifest:       m,
		detectDocker:   system.DetectDocker,
		startupTimeout: 10 * time.Minute,
	}
	return w.execute(ctx)
}

func (w *wizard) execute(ctx context.Context) error {
	ui.Banner(w.out, w.opts.Version)
	steps := []func(context.Context) error{
		w.checks,
		w.basics,
		w.access,
		w.admin,
		w.review,
		w.install,
	}
	for _, step := range steps {
		if err := step(ctx); err != nil {
			if errors.Is(err, huh.ErrUserAborted) {
				return ErrCancelled
			}
			return err
		}
	}
	return nil
}

func (w *wizard) interactive() bool {
	return !w.opts.Yes
}

// form runs fields with Crate's theme; in --yes mode it is never called.
func (w *wizard) form(groups ...*huh.Group) error {
	return huh.NewForm(groups...).
		WithTheme(ui.Theme()).
		WithWidth(ui.Width()).
		WithAccessible(w.opts.Accessible).
		WithShowHelp(true).
		Run()
}

func (w *wizard) confirm(title, description string, value bool) (bool, error) {
	if !w.interactive() {
		return value, nil
	}
	err := w.form(huh.NewGroup(huh.NewConfirm().
		Title(title).
		Description(description).
		Affirmative("Yes").
		Negative("No").
		Value(&value)))
	return value, err
}

// runCommands shows privileged steps, asks once, then runs them in order.
func (w *wizard) runCommands(ctx context.Context, title string, commands []install.Command) error {
	if len(commands) == 0 {
		return nil
	}
	ui.Heading(w.out, title)
	for _, c := range commands {
		fmt.Fprintf(w.out, "  %s\n    %s\n", ui.Value.Render(c.Description), ui.Muted.Render(strings.Join(c.Argv, " ")))
	}
	fmt.Fprintln(w.out)
	ok, err := w.confirm("Run these commands now?", "Commands that start with sudo ask for your password.", true)
	if err != nil {
		return err
	}
	if !ok {
		return fmt.Errorf("stopped before %s", strings.ToLower(title))
	}
	for _, c := range commands {
		ui.Success(w.out, c.Description)
		if err := w.run.Stream(ctx, w.out, "", c.Argv[0], c.Argv[1:]...); err != nil {
			return fmt.Errorf("%s: %w", c.Description, err)
		}
	}
	return nil
}

func expandHome(path string) (string, error) {
	path = strings.TrimSpace(path)
	if path == "~" || strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		path = filepath.Join(home, strings.TrimPrefix(path, "~"))
	}
	return filepath.Abs(path)
}
