package wizard

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/charmbracelet/huh"

	"github.com/thecrateapp/crate/app/installer/internal/agent"
	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/system"
	"github.com/thecrateapp/crate/app/installer/internal/ui"
	"github.com/thecrateapp/crate/app/installer/internal/validate"
)

// Configure sets up or changes integrations of an existing installation.
// With no ids it shows the same choice as the install wizard.
func Configure(ctx context.Context, opts Options, ids []string) error {
	m, err := manifest.Load()
	if err != nil {
		return err
	}
	if !ui.IsTerminal(os.Stdin) {
		return errors.New("`crate configure` asks questions; run it in a terminal")
	}
	w := &wizard{
		opts:           opts,
		out:            os.Stdout,
		run:            system.ExecRunner{Stdin: os.Stdin},
		validate:       validate.NewClient(),
		manifest:       m,
		detectDocker:   system.DetectDocker,
		startupTimeout: 10 * time.Minute,
		agentTimeout:   2 * time.Minute,
		telegramWait:   time.Minute,
		configuring:    true,
	}
	return w.configure(ctx, ids)
}

func (w *wizard) configure(ctx context.Context, ids []string) error {
	dir, err := expandHome(w.opts.InstallDir)
	if err != nil {
		return err
	}
	if w.existing, err = install.ReadExisting(dir); err != nil {
		return err
	}
	if w.existing == nil {
		return fmt.Errorf("no Crate installation in %s; run `crate install` first, or pass --dir", dir)
	}
	w.cfg = install.FromEnvFile(install.Defaults(dir), w.existing)
	ui.Banner(w.out, w.opts.Version)
	if len(ids) == 0 {
		if ids, err = w.chooseIntegrations(false); err != nil {
			return w.cancelled(err)
		}
		if err := w.setUpIntegrations(ctx, ids); err != nil {
			return w.cancelled(err)
		}
	} else {
		for _, id := range ids {
			in, ok := w.integration(id)
			if !ok {
				return fmt.Errorf("unknown integration %q; choose from %s", id, w.integrationIDs())
			}
			if err := w.setUpIntegration(ctx, in); err != nil {
				return w.cancelled(err)
			}
		}
	}
	if w.nothingToApply() {
		ui.Success(w.out, "Nothing changed")
		return nil
	}
	values, err := install.BuildEnv(w.manifest, w.cfg, w.existing)
	if err != nil {
		return err
	}
	if err := envfile.Write(install.EnvPath(dir), envfile.Render(values, install.EnvHeader, install.Sections(w.manifest))); err != nil {
		return err
	}
	ui.Success(w.out, "Saved to "+install.EnvPath(dir))
	return w.restart(ctx, dir)
}

// nothingToApply is true when no answer changed and the agent runs as the
// settings ask.
func (w *wizard) nothingToApply() bool {
	return len(w.cfg.Integrations) == 0 && w.cfg.Profiles == nil && agent.Wanted(w.existing) == agent.Active(w.existing)
}

// integration finds an integration by id; telegram is what the agent was
// called before.
func (w *wizard) integration(id string) (manifest.Integration, bool) {
	if id == "telegram" {
		id = "agent"
	}
	return w.manifest.Integration(id)
}

func (w *wizard) cancelled(err error) error {
	if errors.Is(err, huh.ErrUserAborted) {
		return ErrCancelled
	}
	return err
}

func (w *wizard) integrationIDs() string {
	ids := make([]string, 0, len(w.manifest.Integrations))
	for _, in := range w.manifest.Integrations {
		ids = append(ids, in.ID)
	}
	sort.Strings(ids)
	return strings.Join(ids, ", ")
}

// restart recreates the containers whose settings changed; compose leaves
// the others running.
func (w *wizard) restart(ctx context.Context, dir string) error {
	w.host = system.DetectHost(ctx, w.run)
	docker, state := w.detectDocker(ctx, w.run, w.host)
	if state != system.DockerReady {
		ui.Warning(w.out, "Docker is not reachable; the changes apply the next time Crate starts.")
		return nil
	}
	now, err := w.confirm("Apply the changes now?", "Crate restarts only the services that use these settings, usually in under a minute.", true)
	if err != nil || !now {
		if err == nil {
			ui.Success(w.out, "Apply them later with `docker compose up -d` in "+dir)
		}
		return w.cancelled(err)
	}
	w.docker = docker
	s, err := w.stack(dir)
	if err != nil {
		return err
	}
	if err := s.Up(ctx, w.out); err != nil {
		return fmt.Errorf("restart Crate: %w", err)
	}
	ui.Success(w.out, "Crate restarted with the new settings")
	w.setUpAgent(ctx, s, w.cfg.LocalURLs().API)
	for _, step := range w.agentNextSteps() {
		ui.Success(w.out, step)
	}
	if w.tidal {
		ui.Success(w.out, "Connect Tidal in Admin > Settings > Downloads and enter the code at tidal.com/activate")
	}
	return nil
}
