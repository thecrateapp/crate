package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"slices"
	"strings"

	"github.com/charmbracelet/huh"

	"github.com/thecrateapp/crate/app/installer/internal/monitoring"
	"github.com/thecrateapp/crate/app/installer/internal/system"
	"github.com/thecrateapp/crate/app/installer/internal/ui"
	"github.com/thecrateapp/crate/app/installer/internal/wizard"
)

const observabilityUsage = `Usage: crate observability <enable|disable|status> [--dir DIR] [--yes]

  enable   set up Prometheus and Grafana for this server and connect Crate to them
  disable  disconnect Crate and stop monitoring; its data and settings stay
  status   show whether monitoring runs and Grafana answers

enable reads CRATE_OBSERVABILITY_DIR, CRATE_GRAFANA_PORT and CRATE_GRAFANA_PASSWORD
from the environment. Linux only.
`

func runObservability(args []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("crate observability", flag.ContinueOnError)
	flags.SetOutput(stderr)
	dir := flags.String("dir", defaultInstallDir(), "install folder (CRATE_INSTALL_DIR)")
	yes := flags.Bool("yes", envFlag("CRATE_ASSUME_YES"), "do not ask before restarting Crate (CRATE_ASSUME_YES=1)")
	flags.Usage = func() { fmt.Fprint(stderr, observabilityUsage) }
	positional, err := parseInterspersed(flags, args)
	if errors.Is(err, flag.ErrHelp) {
		return 0
	}
	if err != nil || len(positional) != 1 || !slices.Contains([]string{"enable", "disable", "status"}, positional[0]) {
		fmt.Fprint(stderr, observabilityUsage)
		return 2
	}
	path, err := filepath.Abs(*dir)
	if err != nil {
		return reportError(stderr, err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	run := system.ExecRunner{Stdin: os.Stdin}
	host := system.DetectHost(ctx, run)
	docker, state := system.DetectDocker(ctx, run, host)
	if state != system.DockerReady && host.OS == "linux" {
		return reportError(stderr, errors.New("Docker with Compose v2 is required; run `crate doctor` for details"))
	}
	m := monitoring.New(path, version, run, docker, host, stdout)

	switch positional[0] {
	case "enable":
		if err := confirm(*yes, "Set up monitoring?",
			"Adds 8 small containers capped at 944 MiB of memory and 1 CPU and keeps up to 10 GB of history (keep 20 GB free). "+
				"Grafana listens only on this machine. Crate restarts once to connect to it, which stops playback for a moment."); err != nil {
			return reportError(stderr, err)
		}
		result, err := m.Enable(ctx)
		if err != nil {
			return reportError(stderr, err)
		}
		printEnabled(stdout, result)
	case "disable":
		if err := confirm(*yes, "Turn monitoring off?",
			"Crate restarts once without it and the monitoring containers stop. Its history, settings and passwords stay for the next `crate observability enable`."); err != nil {
			return reportError(stderr, err)
		}
		if err := m.Disable(ctx); err != nil {
			return reportError(stderr, err)
		}
		ui.Success(stdout, "Monitoring is off. Its data is kept.")
	case "status":
		report, err := m.Status(ctx)
		if err != nil {
			return reportError(stderr, err)
		}
		printStatus(stdout, report)
	}
	return 0
}

func confirm(yes bool, title, description string) error {
	if yes {
		return nil
	}
	if !ui.IsTerminal(os.Stdin) {
		return errors.New("pass --yes to confirm when there is no terminal")
	}
	ok := false
	err := huh.NewForm(huh.NewGroup(huh.NewConfirm().Title(title).Description(description).
		Affirmative("Yes").Negative("No").Value(&ok))).WithTheme(ui.Theme()).Run()
	if errors.Is(err, huh.ErrUserAborted) || (err == nil && !ok) {
		return wizard.ErrCancelled
	}
	return err
}

func printEnabled(w io.Writer, result monitoring.Enabled) {
	ui.Success(w, "Monitoring is running")
	ui.Heading(w, "Open Grafana")
	password := "unchanged"
	switch {
	case result.Generated:
		password = result.Password
	case result.Password != "":
		password = "the one you chose"
	}
	ui.Rows(w, [][2]string{{"Address", result.URL}, {"User", monitoring.GrafanaUser}, {"Password", password}})
	if result.Generated {
		fmt.Fprintf(w, "  %s\n", ui.Muted.Render("Save it now; it is not shown again."))
	}
	port := strings.TrimPrefix(result.URL, "http://localhost:")
	fmt.Fprintf(w, "  %s\n\n", ui.Muted.Render("From another computer: ssh -N -L "+port+":127.0.0.1:"+port+" <user>@<this server>"))
}

func printStatus(w io.Writer, report monitoring.Report) {
	ui.Heading(w, "Monitoring")
	if !report.Configured {
		if report.Availability.Available {
			ui.StatusRow(w, ui.ToneInfo, "Monitoring", "not set up", "Turn it on with `crate observability enable`.")
		} else {
			ui.StatusRow(w, ui.ToneInfo, "Monitoring", "not available", report.Availability.Reason)
		}
		return
	}
	running := 0
	for _, service := range report.Services {
		if service.State == "running" {
			running++
		}
	}
	tone := ui.ToneOK
	if running < len(monitoring.Services) {
		tone = ui.ToneWarn
	}
	ui.StatusRow(w, tone, "Services", fmt.Sprintf("%d of %d running", running, len(monitoring.Services)), "")
	switch {
	case !report.Active:
		ui.StatusRow(w, ui.ToneWarn, "Crate", "not connected", "Connect it with `crate observability enable`.")
	case len(report.MissingOverlays) > 0:
		ui.StatusRow(w, ui.ToneFail, "Crate", "a monitoring network is missing", "Crate starts without "+strings.Join(report.MissingOverlays, ", ")+". Run `crate observability enable` to restore it.")
	default:
		ui.StatusRow(w, ui.ToneOK, "Crate", "connected", "")
	}
	if report.GrafanaHealthy {
		ui.StatusRow(w, ui.ToneOK, "Grafana", report.GrafanaURL, "")
	} else {
		ui.StatusRow(w, ui.ToneFail, "Grafana", "not answering at "+report.GrafanaURL, "")
	}
	if report.Setup != nil {
		if report.Setup["role"] && report.Setup["pg_stat_statements"] {
			ui.StatusRow(w, ui.ToneOK, "Database", "monitoring account ready", "")
		} else {
			ui.StatusRow(w, ui.ToneWarn, "Database", "monitoring account missing", "Run `crate observability enable` to create it.")
		}
	}
	fmt.Fprintln(w)
}
