package wizard

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/thecrateapp/crate/app/installer/internal/agent"
	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/stack"
	"github.com/thecrateapp/crate/app/installer/internal/system"
	"github.com/thecrateapp/crate/app/installer/internal/ui"
)

var accessLabels = map[install.AccessMode]string{
	install.AccessPorts:      "Ports",
	install.AccessHosts:      "Local names (/etc/hosts)",
	install.AccessDNSMasq:    "Local names for every device (dnsmasq)",
	install.AccessCloudflare: "Public HTTPS through Cloudflare",
}

func (w *wizard) dnsHost(ctx context.Context) install.DNSHost {
	return install.DetectDNSHost(ctx, w.run, w.host)
}

func (w *wizard) review(ctx context.Context) error {
	ui.Step(w.out, 6, totalSteps, "Review", "Nothing has been written yet.")
	admin := "the password you chose"
	switch {
	case w.existing != nil:
		admin = "unchanged"
	case w.cfg.AdminPasswordGenerated:
		admin = "generated, shown at the end"
	}
	rows := [][2]string{
		{"Install folder", w.cfg.InstallDir},
		{"Music library", w.cfg.MusicDir},
		{"Crate data", w.cfg.DataDir},
		{"Timezone", w.cfg.Timezone},
		{"Instance name", w.cfg.InstanceName},
		{"Access", accessLabels[w.cfg.Access]},
	}
	if urls, ok := w.cfg.DomainURLs(); ok {
		rows = append(rows, [2]string{"Listen", urls.Listen}, [2]string{"Admin", urls.Admin})
	} else {
		local := w.cfg.LocalURLs()
		rows = append(rows, [2]string{"Listen", local.Listen}, [2]string{"Admin", local.Admin})
	}
	rows = append(rows, [2]string{"Admin account", "admin@cratemusic.app · " + admin})
	var enabled []string
	for _, in := range w.ordered() {
		if w.enabled(in) || (in.ID == "tidal" && w.tidal) {
			enabled = append(enabled, in.Title)
		}
	}
	if len(enabled) == 0 {
		enabled = []string{"none yet"}
	}
	rows = append(rows, [2]string{"Integrations", strings.Join(enabled, ", ")})
	ui.Rows(w.out, rows)

	ui.Heading(w.out, "Files")
	var files [][2]string
	for _, action := range install.Plan(w.cfg) {
		files = append(files, [2]string{action.Description, action.Path})
	}
	ui.Rows(w.out, files)
	if w.existing == nil {
		ports := map[string]int{
			"Admin": w.cfg.Ports.Admin, "Listen": w.cfg.Ports.Listen, "API": w.cfg.Ports.API,
			"HTTP": w.cfg.Ports.HTTP, "HTTPS": w.cfg.Ports.HTTPS,
		}
		if check := system.PortsCheck(ports); check.Status != system.OK {
			fmt.Fprintln(w.out)
			ui.StatusRow(w.out, ui.ToneWarn, check.Title, check.Detail, check.Fix)
		}
	}
	fmt.Fprintln(w.out)
	title := "Install Crate now?"
	if w.existing != nil {
		title = "Apply these settings and restart Crate?"
	}
	ok, err := w.confirm(title, "Images are about 4 GB the first time; later updates download only what changed.", true)
	if err != nil {
		return err
	}
	if !ok {
		return ErrCancelled
	}
	return nil
}

func (w *wizard) install(ctx context.Context) error {
	ui.Step(w.out, 7, totalSteps, "Installing", "")
	if w.opts.DryRun {
		ui.Success(w.out, "Dry run: nothing was written and no container was started.")
		return nil
	}
	if err := ui.Spin(w.out, w.interactive(), "Writing the installation", func() error {
		w.cfg.DockerGID = system.SocketGroup(ctx, w.run, w.host)
		return install.Apply(w.manifest, w.cfg, w.existing)
	}); err != nil {
		return err
	}
	ui.Success(w.out, "Settings and secrets written to "+install.EnvPath(w.cfg.InstallDir))

	commands, err := install.LocalNameCommands(w.cfg, w.dnsHost(ctx))
	if err != nil {
		return err
	}
	if err := w.runCommands(ctx, "Local names", commands); err != nil {
		return err
	}
	if w.opts.SkipStart {
		ui.Success(w.out, "Files are ready. Start Crate with `docker compose up -d` in "+w.cfg.InstallDir)
		if agent.Wanted(w.existingAfterApply()) != agent.Off {
			ui.Success(w.out, "Then set up Crate Agent with `"+agent.SetupCommand+"`")
		}
		return nil
	}

	s, err := w.stack(w.cfg.InstallDir)
	if err != nil {
		return err
	}
	ui.Heading(w.out, "Downloading Crate")
	if err := s.Pull(ctx, w.out); err != nil {
		return fmt.Errorf("download the images: %w", err)
	}
	ui.Heading(w.out, "Starting Crate")
	if err := s.Up(ctx, w.out); err != nil {
		return fmt.Errorf("start the containers: %w", err)
	}
	fmt.Fprintln(w.out)
	api := w.cfg.LocalURLs().API
	err = ui.Spin(w.out, w.interactive(), "Waiting for Crate to answer (the first start prepares the database)", func() error {
		return stack.WaitForAPI(ctx, &http.Client{Timeout: 5 * time.Second}, api, w.startupTimeout, time.Second)
	})
	if err != nil {
		ui.Failure(w.out, err.Error())
		fmt.Fprintf(w.out, "    %s\n", ui.Muted.Render("See what is happening with: cd "+w.cfg.InstallDir+" && docker compose logs -f crate-api"))
		return errors.New("Crate did not finish starting")
	}
	ui.Success(w.out, "Crate is running")
	w.setUpAgent(ctx, s, api)
	w.done()
	return nil
}

// stack is the installation's compose project with the files it runs.
func (w *wizard) stack(dir string) (stack.Stack, error) {
	values, err := install.ReadExisting(dir)
	if err != nil {
		return stack.Stack{}, err
	}
	return stack.Stack{Run: w.run, Compose: w.docker.Compose, Dir: dir, Files: install.ComposeFiles(values)}, nil
}

func (w *wizard) existingAfterApply() *envfile.Values {
	values, _ := install.ReadExisting(w.cfg.InstallDir)
	return values
}

func (w *wizard) done() {
	ui.Heading(w.out, "Open Crate")
	local := w.cfg.LocalURLs()
	rows := [][2]string{{"Listen", local.Listen}, {"Admin", local.Admin}}
	if urls, ok := w.cfg.DomainURLs(); ok {
		rows = [][2]string{{"Listen", urls.Listen}, {"Admin", urls.Admin}, {"On this machine", local.Listen}}
	}
	ui.Rows(w.out, rows)

	ui.Heading(w.out, "Sign in")
	account := [][2]string{{"Email", "admin@cratemusic.app"}}
	switch {
	case w.existing != nil:
		account = append(account, [2]string{"Password", "unchanged"})
	case w.cfg.AdminPasswordGenerated:
		account = append(account, [2]string{"Password", w.cfg.AdminPassword})
	default:
		account = append(account, [2]string{"Password", "the one you chose"})
	}
	ui.Rows(w.out, account)
	if w.cfg.AdminPasswordGenerated {
		fmt.Fprintf(w.out, "  %s\n", ui.Muted.Render("Save it in your password manager; it is also DEFAULT_ADMIN_PASSWORD in .env."))
	}

	ui.Heading(w.out, "Next")
	steps := []string{
		"Copy or mount your albums into " + w.cfg.MusicDir,
		"Sign in to Admin; Crate scans the library and starts enriching it",
		"Install the Listen app on your phone and add " + w.cfg.PublicURLs().API,
	}
	if w.tidal {
		steps = append(steps, "Connect Tidal in Admin > Settings > Downloads and enter the code at tidal.com/activate")
	}
	steps = append(steps, w.agentNextSteps()...)
	var next [][2]string
	for i, step := range steps {
		next = append(next, [2]string{fmt.Sprint(i + 1), step})
	}
	ui.Rows(w.out, next)
	ui.Heading(w.out, "Manage")
	ui.Rows(w.out, [][2]string{
		{"Status", "cd " + w.cfg.InstallDir + " && docker compose ps"},
		{"Logs", "cd " + w.cfg.InstallDir + " && docker compose logs -f"},
		{"Integrations", "crate configure --dir " + w.cfg.InstallDir},
		{"Health", "crate doctor --dir " + w.cfg.InstallDir},
		{"Everything else", "crate install --dir " + w.cfg.InstallDir},
	})
	fmt.Fprintln(w.out)
}
