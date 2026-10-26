package wizard

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/huh"

	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/secrets"
	"github.com/thecrateapp/crate/app/installer/internal/system"
	"github.com/thecrateapp/crate/app/installer/internal/ui"
	"github.com/thecrateapp/crate/app/installer/internal/validate"
)

func tone(status system.Status) ui.Tone {
	switch status {
	case system.OK:
		return ui.ToneOK
	case system.Warn:
		return ui.ToneWarn
	}
	return ui.ToneFail
}

func (w *wizard) checks(ctx context.Context) error {
	ui.Step(w.out, 1, totalSteps, "Checking this machine", "Crate runs as a set of Docker containers. Let's make sure this machine can host them.")
	w.host = system.DetectHost(ctx, w.run)
	osName := map[string]string{"linux": "Linux (" + w.host.Distro + ")", "darwin": "macOS"}[w.host.OS]
	if osName == "" {
		ui.StatusRow(w.out, ui.ToneFail, "System", w.host.OS, "Crate installs on Linux and macOS.")
		return fmt.Errorf("unsupported system %s", w.host.OS)
	}
	ui.StatusRow(w.out, ui.ToneOK, "System", osName, "")
	checks := []system.Check{
		system.ArchitectureCheck(w.host),
		system.MemoryCheck(w.host),
		system.DiskCheck(w.opts.InstallDir),
	}
	for _, c := range checks {
		ui.StatusRow(w.out, tone(c.Status), c.Title, c.Detail, c.Fix)
	}
	if checks[0].Status == system.Fail {
		return errors.New("this processor is not supported")
	}
	if w.opts.DryRun {
		ui.StatusRow(w.out, ui.ToneInfo, "Docker", "not checked in a dry run", "")
		return nil
	}
	return w.ensureDocker(ctx)
}

func (w *wizard) ensureDocker(ctx context.Context) error {
	for attempt := 0; attempt < 2; attempt++ {
		docker, state := w.detectDocker(ctx, w.run, w.host)
		check := system.DockerCheck(state, docker, w.host)
		ui.StatusRow(w.out, tone(check.Status), check.Title, check.Detail, check.Fix)
		if state == system.DockerReady {
			w.docker = docker
			return nil
		}
		commands, err := w.dockerFix(state)
		if err != nil || len(commands) == 0 || attempt > 0 {
			return errors.New("Docker is required to run Crate")
		}
		if err := w.runCommands(ctx, "Set up Docker", commands); err != nil {
			return err
		}
		if w.host.OS == "darwin" {
			return errors.New("open Docker Desktop once, wait until it is running, then run `crate install` again")
		}
	}
	return errors.New("Docker is required to run Crate")
}

func (w *wizard) dockerFix(state system.DockerState) ([]install.Command, error) {
	switch {
	case state == system.DockerMissing && w.host.OS == "linux":
		return []install.Command{
			{Description: "Download Docker's official install script", Argv: []string{"curl", "-fsSL", "https://get.docker.com", "-o", "/tmp/crate-get-docker.sh"}},
			{Description: "Install Docker Engine and Compose", Argv: []string{"sudo", "sh", "/tmp/crate-get-docker.sh"}},
			{Description: "Start Docker now and on every boot", Argv: []string{"sudo", "systemctl", "enable", "--now", "docker"}},
		}, nil
	case state == system.DockerMissing && w.host.OS == "darwin":
		if _, err := exec.LookPath("brew"); err != nil {
			return nil, errors.New("no Homebrew")
		}
		return []install.Command{{Description: "Install Docker Desktop with Homebrew", Argv: []string{"brew", "install", "--cask", "docker"}}}, nil
	case state == system.DockerUnreachable && w.host.OS == "linux":
		return []install.Command{{Description: "Start the Docker daemon", Argv: []string{"sudo", "systemctl", "enable", "--now", "docker"}}}, nil
	case state == system.ComposeMissing && w.host.OS == "linux":
		pkg := "docker-compose-plugin"
		if w.host.Distro == "arch" || w.host.Distro == "manjaro" {
			pkg = "docker-compose"
		}
		return install.PackageInstall(w.host.Distro, pkg)
	}
	return nil, nil
}

func (w *wizard) basics(ctx context.Context) error {
	ui.Step(w.out, 2, totalSteps, "Your music and Crate's data", "Crate reads your library in place and never moves files without asking. Its database, cache and artwork live in the data folder.")
	dir := w.opts.InstallDir
	if w.interactive() {
		err := w.form(huh.NewGroup(huh.NewInput().
			Title("Install folder").
			Description("Where Crate keeps its compose file and settings.").
			Value(&dir).
			Validate(func(value string) error {
				_, err := expandHome(value)
				return err
			})))
		if err != nil {
			return err
		}
	}
	installDir, err := expandHome(dir)
	if err != nil {
		return err
	}
	w.cfg = install.Defaults(installDir)
	w.cfg.Timezone = w.host.Timezone
	w.cfg.PUID, w.cfg.PGID = w.host.UID, w.host.GID
	if w.existing, err = install.ReadExisting(installDir); err != nil {
		return fmt.Errorf("read the existing settings: %w", err)
	}
	if w.existing != nil {
		w.cfg = install.FromEnvFile(w.cfg, w.existing)
		ui.Success(w.out, "Found an existing installation. Its settings are prefilled and its secrets are kept.")
	}
	if w.cfg, err = install.WithOverrides(w.cfg, os.Getenv); err != nil {
		return err
	}
	if w.interactive() {
		err := w.form(huh.NewGroup(
			huh.NewInput().
				Title("Music library").
				Description("The folder with your albums, usually Artist/Album/Track. It can be a network mount.").
				Value(&w.cfg.MusicDir).
				Validate(validPath),
			huh.NewInput().
				Title("Crate data").
				Description("Database, cache and artwork. Keep it on a fast disk; it grows with your library.").
				Value(&w.cfg.DataDir).
				Validate(validPath),
			huh.NewInput().
				Title("Timezone").
				Description("Used for listening stats and the nightly maintenance window.").
				Value(&w.cfg.Timezone).
				Validate(validTimezone),
			huh.NewInput().
				Title("Instance name").
				Description("How this Crate introduces itself to apps and other servers.").
				Value(&w.cfg.InstanceName).
				Validate(required("an instance name")),
		))
		if err != nil {
			return err
		}
	}
	for _, path := range []*string{&w.cfg.MusicDir, &w.cfg.DataDir, &w.cfg.DownloadsDir} {
		if *path, err = expandHome(*path); err != nil {
			return err
		}
	}
	w.describeLibrary()
	return nil
}

func (w *wizard) describeLibrary() {
	summary := install.SummarizeLibrary(w.cfg.MusicDir, 3*time.Second)
	switch {
	case !summary.Exists:
		ui.Warning(w.out, "The music folder does not exist yet. Crate will create it; copy your albums there whenever you like.")
	case summary.Files == 0:
		ui.Warning(w.out, "No audio files found in the music folder yet.")
	default:
		count := strconv.Itoa(summary.Files)
		if !summary.Complete {
			count = "more than " + count
		}
		ui.Success(w.out, fmt.Sprintf("Found %s audio files (%s) in your library.", count, humanBytes(summary.Bytes)))
	}
}

func (w *wizard) access(ctx context.Context) error {
	ui.Step(w.out, 3, totalSteps, "How you will reach Crate", "Pick how browsers and the mobile apps find this server. You can change it later by running the installer again.")
	if w.interactive() {
		mode := w.cfg.Access
		err := w.form(huh.NewGroup(huh.NewSelect[install.AccessMode]().
			Title("Access").
			Options(
				huh.NewOption("Ports  ·  http://localhost:8581 on this machine and your network", install.AccessPorts),
				huh.NewOption("Local names  ·  listen.crate.local on this machine (/etc/hosts)", install.AccessHosts),
				huh.NewOption("Local names for every device  ·  a small DNS server (dnsmasq)", install.AccessDNSMasq),
				huh.NewOption("Public HTTPS  ·  your own domain through Cloudflare", install.AccessCloudflare),
			).
			Value(&mode)))
		if err != nil {
			return err
		}
		if mode != w.cfg.Access {
			w.cfg.Access = mode
			w.cfg.Domain = map[install.AccessMode]string{
				install.AccessPorts:   "localhost",
				install.AccessHosts:   install.LocalDomainDefault,
				install.AccessDNSMasq: install.LocalDomainDefault,
			}[mode]
		}
	}
	switch w.cfg.Access {
	case install.AccessHosts, install.AccessDNSMasq:
		if err := w.askDomain("Local domain", "Crate answers on admin., listen. and api. under this name."); err != nil {
			return err
		}
	case install.AccessCloudflare:
		if err := w.askDomain("Your domain", "A domain whose DNS is managed by Cloudflare. Crate uses admin., listen. and api. under it."); err != nil {
			return err
		}
		if err := w.askCloudflareToken(ctx); err != nil {
			return err
		}
	}
	if !w.interactive() {
		ui.Success(w.out, accessLabels[w.cfg.Access]+" · "+w.cfg.PublicURLs().Listen)
	}
	return w.askPorts()
}

func (w *wizard) askDomain(title, description string) error {
	if !w.interactive() {
		return install.ValidateDomain(w.cfg.Domain)
	}
	return w.form(huh.NewGroup(huh.NewInput().
		Title(title).
		Description(description).
		Value(&w.cfg.Domain).
		Validate(install.ValidateDomain)))
}

func (w *wizard) askCloudflareToken(ctx context.Context) error {
	if !w.interactive() {
		if w.cfg.CloudflareToken == "" {
			ui.Warning(w.out, "No Cloudflare token: HTTPS certificates will not be issued until you add CF_DNS_API_TOKEN to .env.")
		}
		return nil
	}
	guide := strings.Join([]string{
		"Crate gets free HTTPS certificates from Let's Encrypt by proving it owns the domain through Cloudflare's DNS.",
		"",
		"1. Open " + ui.Link.Render("https://dash.cloudflare.com/profile/api-tokens"),
		"2. Create Token  →  use the \"Edit zone DNS\" template",
		"3. Zone Resources: include the zone of " + w.cfg.Domain,
		"4. Create the token and paste it below",
	}, "\n")
	return w.form(huh.NewGroup(
		huh.NewNote().Title("Cloudflare API token").Description(guide),
		huh.NewInput().
			Title("Token").
			Description("Leave it empty to add it later; Crate will run without HTTPS until then.").
			EchoMode(huh.EchoModePassword).
			Value(&w.cfg.CloudflareToken).
			Validate(func(token string) error {
				if strings.TrimSpace(token) == "" {
					return nil
				}
				if err := w.validate.CloudflareToken(ctx, strings.TrimSpace(token)); err != nil {
					if errors.Is(err, validate.ErrRejected) {
						return errors.New("Cloudflare says this token is not active; check it and try again")
					}
					return err
				}
				return nil
			}),
	))
}

func (w *wizard) askPorts() error {
	change, err := w.confirm("Change the default ports?", "Defaults: Admin 8580, Listen 8581, API 8585, HTTP 80, HTTPS 443. Change them only if something else uses them.", false)
	if err != nil || !change {
		return err
	}
	fields := []struct {
		title string
		port  *int
	}{
		{"Admin", &w.cfg.Ports.Admin},
		{"Listen", &w.cfg.Ports.Listen},
		{"API", &w.cfg.Ports.API},
		{"HTTP", &w.cfg.Ports.HTTP},
		{"HTTPS", &w.cfg.Ports.HTTPS},
	}
	values := make([]string, len(fields))
	var inputs []huh.Field
	for i, f := range fields {
		values[i] = strconv.Itoa(*f.port)
		inputs = append(inputs, huh.NewInput().Title(f.title+" port").Value(&values[i]).Validate(validPort))
	}
	if err := w.form(huh.NewGroup(inputs...)); err != nil {
		return err
	}
	for i, f := range fields {
		*f.port, _ = strconv.Atoi(values[i])
	}
	return nil
}

func (w *wizard) admin(context.Context) error {
	ui.Step(w.out, 4, totalSteps, "Your admin account", "You sign in to Admin and Listen with this account. Invite other people from Admin later.")
	if w.existing != nil {
		ui.Success(w.out, "The admin account already exists. Change its password from Admin > Users.")
		w.cfg.AdminPassword = ""
		return nil
	}
	if w.interactive() && w.cfg.AdminPassword == "" {
		var confirmation string
		err := w.form(huh.NewGroup(
			huh.NewNote().Title("admin@cratemusic.app").Description("This is the admin user's email. Choose its password, or leave it empty and Crate will generate a strong one."),
			huh.NewInput().
				Title("Password").
				EchoMode(huh.EchoModePassword).
				Value(&w.cfg.AdminPassword).
				Validate(func(value string) error {
					if value != "" && len(value) < 8 {
						return errors.New("use at least 8 characters, or leave it empty")
					}
					return nil
				}),
			huh.NewInput().
				Title("Repeat the password").
				EchoMode(huh.EchoModePassword).
				Value(&confirmation).
				Validate(func(value string) error {
					if value != w.cfg.AdminPassword {
						return errors.New("the passwords do not match")
					}
					return nil
				}),
		))
		if err != nil {
			return err
		}
	}
	if w.cfg.AdminPassword == "" {
		password, err := secrets.Password()
		if err != nil {
			return err
		}
		w.cfg.AdminPassword, w.cfg.AdminPasswordGenerated = password, true
		ui.Success(w.out, "Crate will generate the admin password and show it when the installation finishes.")
	}
	return nil
}

func validPath(value string) error {
	if strings.TrimSpace(value) == "" {
		return errors.New("enter a folder")
	}
	_, err := expandHome(value)
	return err
}

func validTimezone(value string) error {
	if _, err := time.LoadLocation(value); err != nil {
		return errors.New("use an IANA timezone such as Europe/Madrid or America/New_York")
	}
	return nil
}

func validPort(value string) error {
	port, err := strconv.Atoi(value)
	if err != nil || port < 1 || port > 65535 {
		return errors.New("use a number between 1 and 65535")
	}
	return nil
}

func required(what string) func(string) error {
	return func(value string) error {
		if strings.TrimSpace(value) == "" {
			return errors.New("enter " + what)
		}
		return nil
	}
}

func humanBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for value := n / unit; value >= unit; value /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGTPE"[exp])
}
