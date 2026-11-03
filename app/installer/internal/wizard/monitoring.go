package wizard

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/charmbracelet/huh"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/monitoring"
	"github.com/thecrateapp/crate/app/installer/internal/observability"
	"github.com/thecrateapp/crate/app/installer/internal/system"
	"github.com/thecrateapp/crate/app/installer/internal/ui"
)

// Observability modes for --observability and CRATE_OBSERVABILITY.
const (
	ObservabilityOn   = "on"
	ObservabilityOff  = "off"
	ObservabilityKeep = "keep"
)

const monitoringCost = "Grafana dashboards for this server: the host, the containers, PostgreSQL, Redis and Crate itself, kept for up to 90 days. " +
	"Adds 8 small containers capped at 944 MiB of memory and 1 CPU, and uses up to 10 GB of disk (keep 20 GB free). " +
	"Grafana listens only on this machine and is never published. It sends no alerts. Turn it on or off later with `crate observability`."

type monitoringPlan struct {
	available observability.Availability
	active    bool
	stored    *envfile.Values
	want      bool
	keepFiles bool
	dataDir   string
	port      string
	password  string
	before    monitoring.Snapshot
	result    monitoring.Enabled
	done      bool
}

func (w *wizard) monitor() monitoring.Monitor {
	m := monitoring.New(w.cfg.InstallDir, w.opts.Version, w.run, w.docker, w.host, w.out)
	answers := map[string]string{
		"CRATE_OBSERVABILITY_DIR": w.mon.dataDir,
		"CRATE_GRAFANA_PORT":      w.mon.port,
		"CRATE_GRAFANA_PASSWORD":  w.mon.password,
	}
	m.Getenv = func(key string) string {
		if value, ok := answers[key]; ok {
			return value
		}
		return os.Getenv(key)
	}
	return m
}

func (w *wizard) storedMonitoring() *envfile.Values {
	values, err := envfile.Read(filepath.Join(w.cfg.InstallDir, monitoring.EnvName))
	if err != nil {
		return nil
	}
	return values
}

func storedValue(values *envfile.Values, key string) string {
	if values == nil {
		return ""
	}
	value, _ := values.Get(key)
	return strings.TrimSpace(value)
}

func (w *wizard) monitoringStep(ctx context.Context) error {
	ui.Step(w.out, 5, totalSteps, "Monitoring (optional)", monitoringCost)
	mode := w.opts.Observability
	if mode == "" {
		mode = ObservabilityKeep
	}
	w.mon.active = w.existing != nil && observability.Active(w.existing)
	w.mon.stored = w.storedMonitoring()
	if release := storedValue(w.mon.stored, "OBS_RELEASE"); !observability.MayWrite(release, w.opts.Version) {
		w.mon.keepFiles = true
		ui.StatusRow(w.out, ui.ToneWarn, "Monitoring", "set up by crate "+release, "This installer is older; it leaves monitoring as it is. Use crate "+release+" or newer to change it.")
		return nil
	}
	switch {
	case w.opts.DryRun && w.host.OS == "linux":
		w.mon.available = observability.Availability{Available: true}
	default:
		w.mon.available = w.monitor().Availability(ctx)
	}
	if !w.mon.available.Available {
		ui.StatusRow(w.out, ui.ToneInfo, "Monitoring", "not available", w.mon.available.Reason)
		if mode == ObservabilityOn {
			return fmt.Errorf("monitoring is not available here: %s", w.mon.available.Reason)
		}
		return nil
	}
	w.mon.dataDir = storedValue(w.mon.stored, "OBS_DATA_DIR")
	if w.mon.dataDir == "" {
		w.mon.dataDir = strings.TrimSpace(os.Getenv("CRATE_OBSERVABILITY_DIR"))
	}
	if w.mon.dataDir == "" {
		w.mon.dataDir = observability.DefaultDataDir(w.cfg.DataDir)
	}
	w.mon.port = strings.TrimSpace(os.Getenv("CRATE_GRAFANA_PORT"))
	if w.mon.port == "" {
		w.mon.port = storedValue(w.mon.stored, "OBS_GRAFANA_PORT")
	}
	if w.mon.port == "" {
		w.mon.port = monitoring.DefaultPort
	}
	if !w.interactive() {
		w.mon.want = mode == ObservabilityOn || (mode == ObservabilityKeep && w.mon.active)
		w.mon.password = strings.TrimSpace(os.Getenv("CRATE_GRAFANA_PASSWORD"))
		return w.reportMonitoring()
	}
	description := "Off by default. You can turn it on later with `crate observability enable`."
	if w.existing != nil && !w.mon.active {
		description = "Crate restarts once to connect to it, which stops playback for a moment."
	}
	want, err := w.confirm("Set up monitoring?", description, w.mon.active)
	if err != nil {
		return err
	}
	w.mon.want = want
	if !want || w.mon.stored != nil {
		return w.reportMonitoring()
	}
	err = w.form(huh.NewGroup(
		huh.NewInput().Title("Monitoring data").
			Description("Prometheus history and Grafana's database. Up to 10 GB; count it in your backups of the data folder.").
			Value(&w.mon.dataDir).Validate(validPath),
		huh.NewInput().Title("Grafana port").Description("On this machine only.").
			Value(&w.mon.port).Validate(validPort),
		huh.NewInput().Title("Grafana password").
			Description("For the user admin. Leave it empty and Crate will generate one and show it once at the end.").
			EchoMode(huh.EchoModePassword).Value(&w.mon.password).
			Validate(func(value string) error {
				if value != "" && len(value) < 12 {
					return errors.New("use at least 12 characters, or leave it empty")
				}
				return nil
			}),
	))
	if err != nil {
		return err
	}
	if w.mon.dataDir, err = expandHome(w.mon.dataDir); err != nil {
		return err
	}
	return w.reportMonitoring()
}

func (w *wizard) reportMonitoring() error {
	if !w.mon.want {
		if w.mon.active {
			ui.StatusRow(w.out, ui.ToneWarn, "Monitoring", "will be turned off", "Its data stays in "+w.mon.dataDir+".")
		}
		return nil
	}
	if w.mon.password != "" && len(w.mon.password) < 12 {
		return errors.New("CRATE_GRAFANA_PASSWORD needs at least 12 characters")
	}
	check := system.DiskCheck(w.mon.dataDir)
	tone := ui.ToneOK
	if check.Status != system.OK {
		tone = ui.ToneWarn
	}
	ui.StatusRow(w.out, tone, "Monitoring", w.mon.dataDir, check.Detail)
	if w.existing != nil && !w.mon.active {
		ui.Warning(w.out, "Crate restarts once to connect to monitoring, which stops playback for a moment.")
	}
	return nil
}

func (w *wizard) monitoringSummary() string {
	switch {
	case w.mon.keepFiles:
		return "unchanged (set up by a newer installer)"
	case !w.mon.available.Available:
		return "not available"
	case !w.mon.want && w.mon.active:
		return "turn off; data kept"
	case !w.mon.want:
		return "off"
	}
	return "on · " + w.mon.dataDir + " · Grafana http://localhost:" + w.mon.port
}

// beforeApply records the files running monitoring reads, so the upgrade
// after Apply knows what changed.
func (w *wizard) beforeApply() {
	w.cfg.KeepMonitoringFiles = w.mon.keepFiles
	if w.mon.active && !w.mon.keepFiles {
		w.mon.before = w.monitor().Snapshot()
	}
}

// applyMonitoring runs once Crate answers.
func (w *wizard) applyMonitoring(ctx context.Context) error {
	if w.mon.keepFiles {
		return nil
	}
	m := w.monitor()
	var err error
	switch {
	case w.mon.want && w.mon.active:
		ui.Heading(w.out, "Updating monitoring")
		w.mon.result, err = m.Upgrade(ctx, w.mon.before)
	case w.mon.want:
		ui.Heading(w.out, "Starting monitoring")
		w.mon.result, err = m.Enable(ctx)
	case w.mon.active:
		ui.Heading(w.out, "Turning monitoring off")
		err = m.Disable(ctx)
	default:
		return nil
	}
	if err != nil {
		ui.Failure(w.out, err.Error())
		fmt.Fprintf(w.out, "    %s\n", ui.Muted.Render("Crate is running. Check monitoring with `crate observability status --dir "+w.cfg.InstallDir+"`."))
		return errors.New("monitoring did not start")
	}
	w.mon.done = w.mon.want
	return nil
}

func (w *wizard) monitoringNextSteps() []string {
	if w.mon.want == w.mon.active || w.mon.keepFiles {
		return nil
	}
	if w.mon.want {
		return []string{"Turn monitoring on once Crate runs: crate observability enable --dir " + w.cfg.InstallDir}
	}
	return []string{"Turn monitoring off: crate observability disable --dir " + w.cfg.InstallDir}
}
