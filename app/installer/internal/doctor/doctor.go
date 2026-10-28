// Package doctor checks a Crate installation end to end: the machine,
// Docker, the services, the API and every configured integration.
package doctor

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/thecrateapp/crate/app/installer/internal/agent"
	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/stack"
	"github.com/thecrateapp/crate/app/installer/internal/system"
	"github.com/thecrateapp/crate/app/installer/internal/ui"
	"github.com/thecrateapp/crate/app/installer/internal/validate"
)

type Status string

const (
	OK   Status = "ok"
	Warn Status = "warn"
	Fail Status = "fail"
	Skip Status = "skip"
)

type Item struct {
	Section string `json:"section"`
	Name    string `json:"name"`
	Status  Status `json:"status"`
	Detail  string `json:"detail,omitempty"`
	Fix     string `json:"fix,omitempty"`
}

type Report struct {
	Healthy bool   `json:"healthy"`
	Items   []Item `json:"items"`
}

type Deps struct {
	Run          system.Runner
	Validate     validate.Client
	HTTP         *http.Client
	DetectDocker func(context.Context, system.Runner, system.Host) (system.Docker, system.DockerState)
}

func DefaultDeps() Deps {
	return Deps{
		Run:          system.ExecRunner{},
		Validate:     validate.NewClient(),
		HTTP:         &http.Client{Timeout: 5 * time.Second},
		DetectDocker: system.DetectDocker,
	}
}

type report struct{ items []Item }

func (r *report) add(section, name string, status Status, detail, fix string) {
	r.items = append(r.items, Item{section, name, status, detail, fix})
}

func fromCheck(section string, check system.Check) Item {
	status := map[system.Status]Status{system.OK: OK, system.Warn: Warn, system.Fail: Fail}[check.Status]
	return Item{section, check.Title, status, check.Detail, check.Fix}
}

func Run(ctx context.Context, dir string, deps Deps) (Report, error) {
	m, err := manifest.Load()
	if err != nil {
		return Report{}, err
	}
	r := &report{}
	host := system.DetectHost(ctx, deps.Run)
	r.items = append(r.items, fromCheck("Machine", system.ArchitectureCheck(host)), fromCheck("Machine", system.MemoryCheck(host)))

	values, err := install.ReadExisting(dir)
	if err != nil {
		return Report{}, err
	}
	if values == nil {
		r.add("Installation", "Settings", Fail, "no .env in "+dir, "Run `crate install --dir "+dir+"`.")
		return r.finish(), nil
	}
	cfg := install.FromEnvFile(install.Defaults(dir), values)
	r.items = append(r.items, fromCheck("Machine", system.DiskCheck(cfg.DataDir)))
	checkSettings(r, m, dir, values)

	docker, state := deps.DetectDocker(ctx, deps.Run, host)
	r.items = append(r.items, fromCheck("Docker", system.DockerCheck(state, docker, host)))
	s := stack.Stack{Run: deps.Run, Compose: docker.Compose, Dir: dir, Files: install.ComposeFiles(values)}
	if state == system.DockerReady {
		checkServices(ctx, r, s)
	}
	checkAPI(ctx, r, deps.HTTP, cfg.LocalURLs().API)
	checkIntegrations(ctx, r, m, values, deps.Validate)
	checkAgent(ctx, r, values, agent.Setup{Stack: s, Docker: docker.Docker}, state == system.DockerReady)
	return r.finish(), nil
}

func (r *report) finish() Report {
	healthy := !slices.ContainsFunc(r.items, func(i Item) bool { return i.Status == Fail })
	return Report{Healthy: healthy, Items: r.items}
}

func checkSettings(r *report, m *manifest.Manifest, dir string, values *envfile.Values) {
	if info, err := os.Stat(install.EnvPath(dir)); err == nil && info.Mode().Perm()&0o077 != 0 {
		r.add("Installation", "Settings file", Warn, fmt.Sprintf(".env is readable by other users (%v)", info.Mode().Perm()), "chmod 600 "+install.EnvPath(dir))
	} else {
		r.add("Installation", "Settings file", OK, install.EnvPath(dir), "")
	}
	var missing []string
	for _, g := range m.Generated {
		if value, _ := values.Get(g.Env); value == "" {
			missing = append(missing, g.Env)
		}
	}
	if len(missing) > 0 {
		r.add("Installation", "Secrets", Warn, "missing "+strings.Join(missing, ", "), "Run `crate install --dir "+dir+"`; it adds missing secrets and keeps the rest.")
	} else {
		r.add("Installation", "Secrets", OK, "all present", "")
	}
}

func checkServices(ctx context.Context, r *report, s stack.Stack) {
	services, err := s.Services(ctx)
	if err != nil {
		r.add("Services", "Containers", Fail, err.Error(), "")
		return
	}
	if len(services) == 0 {
		r.add("Services", "Containers", Fail, "Crate is not running", "Start it with `docker compose up -d` in "+s.Dir+".")
		return
	}
	for _, service := range services {
		switch {
		case service.State != "running":
			r.add("Services", service.Service, Fail, service.State+" "+service.Status, "Look at `docker compose logs "+service.Service+"`.")
		case service.Health == "unhealthy":
			r.add("Services", service.Service, Fail, "unhealthy", "Look at `docker compose logs "+service.Service+"`.")
		case service.Health == "starting":
			r.add("Services", service.Service, Warn, "starting", "")
		default:
			r.add("Services", service.Service, OK, "running", "")
		}
	}
}

func checkAPI(ctx context.Context, r *report, client *http.Client, api string) {
	err := stack.WaitForAPI(ctx, client, api, 5*time.Second, time.Second)
	if err != nil {
		r.add("API", api, Fail, "no answer at /api/status", "Look at `docker compose logs crate-api`.")
		return
	}
	r.add("API", api, OK, "answering", "")
}

func checkIntegrations(ctx context.Context, r *report, m *manifest.Manifest, values *envfile.Values, client validate.Client) {
	get := func(key string) string {
		value, _ := values.Get(key)
		return value
	}
	var notSet []string
	for _, in := range m.Integrations {
		if !install.IntegrationEnabled(in, get) {
			notSet = append(notSet, in.Title)
			continue
		}
		v := validate.Values{}
		for _, env := range in.Env {
			v[env.Name] = get(env.Name)
		}
		result := client.Check(ctx, in.ID, v)
		status := map[validate.Status]Status{
			validate.Valid: OK, validate.Rejected: Fail, validate.Incomplete: Fail,
			validate.Unreachable: Warn, validate.Skipped: Skip,
		}[result.Status]
		fix := ""
		if status == Fail {
			fix = "Run `crate configure " + in.ID + "` to fix it."
		}
		r.add("Integrations", in.Title, status, result.Message, fix)
	}
	if len(notSet) > 0 {
		r.add("Integrations", "Not set up", Skip, strings.Join(notSet, ", "), "Add them with `crate configure`.")
	}
}

// checkAgent reports whether Crate Agent or Crate Operator runs as the
// settings ask and, when it runs, whether it reaches Crate and its model.
func checkAgent(ctx context.Context, r *report, values *envfile.Values, setup agent.Setup, docker bool) {
	wanted, active := agent.Wanted(values), agent.Active(values)
	fix := "Run `" + agent.SetupCommand + "`."
	switch {
	case wanted == agent.Off && active == agent.Off:
		return
	case wanted != active && wanted == agent.Off:
		r.add("Crate Agent", active.Name(), Fail, "runs although the settings turned it off", fix)
		return
	case wanted != active:
		r.add("Crate Agent", wanted.Name(), Fail, "set up in the settings but not running", fix)
		return
	case wanted == agent.Operator && !slices.Contains(install.ComposeFiles(values), agent.OperatorOverlay):
		r.add("Crate Agent", wanted.Name(), Fail, "runs without its compose overlay", fix)
		return
	case !docker:
		return
	}
	status, err := setup.Check(ctx, values, wanted)
	container := wanted.Profile().Container
	switch {
	case err != nil:
		r.add("Crate Agent", wanted.Name(), Fail, err.Error(), fix+" Logs: `docker compose logs "+container+"`.")
	case !status.Ready:
		r.add("Crate Agent", wanted.Name(), Fail, status.MCP, fix)
	case status.SignInPending:
		provider, _ := agent.FindProvider(get(values, "CRATE_AGENT_PROVIDER"))
		r.add("Crate Agent", wanted.Name(), Warn, "Sign-in pending: run `"+agent.SignInCommand+"` in a terminal", provider.SignIn+" so it can answer.")
		for i, item := range r.items {
			if item.Section == "Services" && item.Name == container && item.Status == Fail && item.Detail == "unhealthy" {
				r.items[i].Status, r.items[i].Detail = Warn, "waiting for the sign-in"
			}
		}
	default:
		r.add("Crate Agent", wanted.Name(), OK, "reaches Crate ("+status.MCP+")", "")
	}
}

func get(values *envfile.Values, key string) string {
	value, _ := values.Get(key)
	return value
}

func Print(w io.Writer, report Report) {
	section := ""
	for _, item := range report.Items {
		if item.Section != section {
			section = item.Section
			ui.Heading(w, section)
		}
		tone := map[Status]ui.Tone{OK: ui.ToneOK, Warn: ui.ToneWarn, Fail: ui.ToneFail, Skip: ui.ToneInfo}[item.Status]
		ui.StatusRow(w, tone, item.Name, item.Detail, item.Fix)
	}
	fmt.Fprintln(w)
	if report.Healthy {
		ui.Success(w, "Crate looks healthy")
	} else {
		ui.Failure(w, "Some checks failed; the hints above say what to do")
	}
	fmt.Fprintln(w)
}

func PrintJSON(w io.Writer, report Report) error {
	encoder := json.NewEncoder(w)
	encoder.SetIndent("", "  ")
	return encoder.Encode(report)
}
