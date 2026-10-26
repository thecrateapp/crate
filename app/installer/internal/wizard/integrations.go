package wizard

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/charmbracelet/huh"

	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/ui"
	"github.com/thecrateapp/crate/app/installer/internal/validate"
)

var groupOrder = []string{"enrichment", "shows", "acquisition", "notifications", "ai", "accounts"}

func (w *wizard) draft() install.Draft {
	return install.Draft{Config: &w.cfg, Existing: w.existing}
}

func (w *wizard) value(env string) string { return w.draft().Value(env) }

func (w *wizard) set(env, value string) { w.draft().Set(env, value) }

func (w *wizard) values(in manifest.Integration) validate.Values {
	return w.draft().Values(in)
}

func (w *wizard) clear(in manifest.Integration) { w.draft().Clear(in) }

func (w *wizard) setProfile(profile string, on bool) { w.draft().SetProfile(profile, on) }

func (w *wizard) enabled(in manifest.Integration) bool { return w.draft().Enabled(in) }

// ordered lists the integrations by group, keeping manifest order inside one.
func (w *wizard) ordered() []manifest.Integration {
	list := slices.Clone(w.manifest.Integrations)
	slices.SortStableFunc(list, func(a, b manifest.Integration) int {
		return slices.Index(groupOrder, a.Group) - slices.Index(groupOrder, b.Group)
	})
	return list
}

func (w *wizard) integrations(ctx context.Context) error {
	ui.Step(w.out, 4, totalSteps, "Integrations", "Crate works on its own. These services add artwork, biographies, concerts, downloads and alerts; each takes a minute to set up. Add or change them any time with `crate configure`.")
	if !w.interactive() {
		w.reportIntegrations(ctx)
		return nil
	}
	ids, err := w.chooseIntegrations(w.existing == nil)
	if err != nil {
		return err
	}
	return w.setUpIntegrations(ctx, ids)
}

func (w *wizard) chooseIntegrations(suggest bool) ([]string, error) {
	var options []huh.Option[string]
	var selected []string
	width := 0
	for _, in := range w.manifest.Integrations {
		width = max(width, len(in.Title))
	}
	for _, in := range w.ordered() {
		label := fmt.Sprintf("%-*s  ", width, in.Title) + ui.Muted.Render(in.Tagline)
		if in.Recommended {
			label += ui.Accent.Render("  recommended")
		}
		on := w.enabled(in) || (suggest && in.Recommended)
		options = append(options, huh.NewOption(label, in.ID).Selected(on))
		if on {
			selected = append(selected, in.ID)
		}
	}
	err := w.form(huh.NewGroup(huh.NewMultiSelect[string]().
		Title("What do you want to set up now?").
		Description("Space selects, enter continues. Nothing is required.").
		Options(options...).
		Height(min(len(options)+4, 18)).
		Value(&selected)))
	return selected, err
}

func (w *wizard) setUpIntegrations(ctx context.Context, ids []string) error {
	for _, in := range w.ordered() {
		if w.enabled(in) && !slices.Contains(ids, in.ID) {
			off, err := w.confirm("Turn "+in.Title+" off?", "Its keys are removed from .env. You can set it up again later.", true)
			if err != nil {
				return err
			}
			if off {
				w.clear(in)
				ui.Success(w.out, in.Title+" turned off")
			}
		}
	}
	for _, in := range w.ordered() {
		if slices.Contains(ids, in.ID) {
			if err := w.setUpIntegration(ctx, in); err != nil {
				return err
			}
		}
	}
	return nil
}

var errLater = errors.New("set up later")

func (w *wizard) setUpIntegration(ctx context.Context, in manifest.Integration) error {
	for {
		if err := w.integrationForm(ctx, in); err != nil {
			if errors.Is(err, errLater) {
				return nil
			}
			return err
		}
		var result validate.Result
		ui.Spin(w.out, true, "Checking "+in.Title, func() error {
			result = w.validate.Check(ctx, in.ID, w.values(in))
			return nil
		})
		switch result.Status {
		case validate.Valid:
			ui.Success(w.out, in.Title+": "+result.Message)
			return nil
		case validate.Skipped:
			ui.Success(w.out, in.Title+" saved")
			return nil
		}
		ui.Warning(w.out, in.Title+": "+result.Message)
		next := "retry"
		options := []huh.Option[string]{
			huh.NewOption("Try again", "retry"),
			huh.NewOption("Set it up later", "later"),
		}
		if result.Status == validate.Unreachable {
			options = append([]huh.Option[string]{huh.NewOption("Keep it; the service may just be down", "keep")}, options...)
			next = "keep"
		}
		if err := w.form(huh.NewGroup(huh.NewSelect[string]().Title("What now?").Options(options...).Value(&next))); err != nil {
			return err
		}
		switch next {
		case "keep":
			return nil
		case "later":
			w.clear(in)
			return nil
		}
	}
}

func guide(in manifest.Integration, extra ...string) string {
	lines := []string{in.Summary, ""}
	if in.GetKey.URL != "" {
		lines = append(lines, "Get it at "+ui.Link.Render(in.GetKey.URL))
	}
	for i, step := range in.GetKey.Steps {
		lines = append(lines, fmt.Sprintf("%d. %s", i+1, step))
	}
	return strings.Join(append(lines, extra...), "\n")
}

func (w *wizard) integrationForm(ctx context.Context, in manifest.Integration) error {
	switch in.ID {
	case "tidal":
		return w.tidalForm(in)
	case "soulseek":
		return w.soulseekForm(in)
	case "ai":
		return w.aiForm(in)
	case "mcp":
		return w.mcpForm(in)
	case "telegram":
		return w.telegramForm(ctx, in)
	case "google-login":
		return w.fieldsForm(in, in.Env, "Redirect URI: "+w.cfg.PublicURLs().API+"/api/auth/oauth/google/callback")
	case "apple-login":
		return w.fieldsForm(in, in.Env, "Return URL: "+w.cfg.PublicURLs().API+"/api/auth/oauth/apple/callback")
	}
	return w.fieldsForm(in, in.Env)
}

// fieldsForm asks for each variable with the integration's guide on top.
func (w *wizard) fieldsForm(in manifest.Integration, envs []manifest.IntegrationEnv, extra ...string) error {
	answers := make([]string, len(envs))
	fields := []huh.Field{huh.NewNote().Title(in.Title).Description(guide(in, extra...))}
	for i, env := range envs {
		answers[i] = w.value(env.Name)
		if answers[i] == "" {
			answers[i] = env.Default
		}
		fields = append(fields, w.input(env, &answers[i]))
	}
	if err := w.form(huh.NewGroup(fields...)); err != nil {
		return err
	}
	for i, env := range envs {
		w.set(env.Name, answers[i])
	}
	return nil
}

func (w *wizard) input(env manifest.IntegrationEnv, value *string) huh.Field {
	if env.Name == "APPLE_PRIVATE_KEY" {
		return huh.NewText().Title(env.Label).Description("Paste the whole .p8 file, including the BEGIN and END lines.").Value(value)
	}
	input := huh.NewInput().Title(env.Label).Value(value)
	if env.Placeholder != "" {
		input = input.Placeholder(env.Placeholder)
	}
	if env.Secret {
		input = input.EchoMode(huh.EchoModePassword)
	}
	return input
}

func (w *wizard) tidalForm(in manifest.Integration) error {
	w.tidal = true
	return w.form(huh.NewGroup(huh.NewNote().
		Title(in.Title).
		Description(guide(in, "", "Nothing to enter now: Crate shows you the code once it is running.")).
		Next(true)))
}

func (w *wizard) soulseekForm(in manifest.Integration) error {
	mode := "bundled"
	if url := w.value("SLSKD_URL"); url != "" && url != install.BundledSlskdURL {
		mode = "external"
	}
	err := w.form(huh.NewGroup(
		huh.NewNote().Title(in.Title).Description(guide(in)),
		huh.NewSelect[string]().
			Title("Which slskd?").
			Options(
				huh.NewOption("Run slskd with Crate (recommended)", "bundled"),
				huh.NewOption("Use an slskd server I already run", "external"),
			).
			Value(&mode),
	))
	if err != nil {
		return err
	}
	byName := func(names ...string) []manifest.IntegrationEnv {
		var envs []manifest.IntegrationEnv
		for _, env := range in.Env {
			if slices.Contains(names, env.Name) {
				envs = append(envs, env)
			}
		}
		return envs
	}
	if mode == "external" {
		w.draft().UseExternalSlskd()
		return w.fieldsForm(in, byName("SLSKD_URL", "SLSKD_API_KEY"))
	}
	if err := w.fieldsForm(in, byName("SLSKD_SLSK_USERNAME", "SLSKD_SLSK_PASSWORD", "SLSKD_LISTEN_PORT")); err != nil {
		return err
	}
	if w.value("SLSKD_SLSK_USERNAME") == "" || w.value("SLSKD_SLSK_PASSWORD") == "" {
		ui.Warning(w.out, "slskd needs a Soulseek username and password to sign in.")
		return w.soulseekForm(in)
	}
	return w.draft().UseBundledSlskd()
}

type aiProvider struct {
	id, title, env, model, hint string
}

var aiProviders = []aiProvider{
	{"gemini", "Gemini", "GEMINI_API_KEY", "gemini/gemini-2.5-flash", "free tier at https://aistudio.google.com/app/apikey"},
	{"openai", "OpenAI", "OPENAI_API_KEY", "openai/gpt-4o-mini", "keys at https://platform.openai.com/api-keys"},
	{"anthropic", "Anthropic", "ANTHROPIC_API_KEY", "anthropic/claude-sonnet-5-5", "keys at https://console.anthropic.com/settings/keys"},
	{"ollama", "Ollama on this network", "OLLAMA_URL", "ollama/llama3.1:8b", "runs models locally, no key"},
}

func (w *wizard) aiForm(in manifest.Integration) error {
	var chosen []string
	var options []huh.Option[string]
	for _, p := range aiProviders {
		on := w.value(p.env) != ""
		if on {
			chosen = append(chosen, p.id)
		}
		options = append(options, huh.NewOption(p.title+ui.Muted.Render("  ·  "+p.hint), p.id).Selected(on))
	}
	if len(chosen) == 0 {
		chosen = []string{"gemini"}
	}
	err := w.form(huh.NewGroup(
		huh.NewNote().Title(in.Title).Description(in.Summary+"\n\nCrate stores these keys encrypted once it runs; you can also manage them in Admin > AI."),
		huh.NewMultiSelect[string]().Title("Providers").Options(options...).Value(&chosen),
	))
	if err != nil {
		return err
	}
	answers := map[string]*string{}
	var fields []huh.Field
	var models []huh.Option[string]
	for _, p := range aiProviders {
		if !slices.Contains(chosen, p.id) {
			w.set(p.env, "")
			continue
		}
		value := w.value(p.env)
		if p.id == "ollama" && value == "" {
			value = "http://host.docker.internal:11434"
		}
		answers[p.env] = &value
		input := huh.NewInput().Title(p.title).Description(p.hint).Value(answers[p.env])
		if p.id != "ollama" {
			input = input.EchoMode(huh.EchoModePassword)
		}
		fields = append(fields, input)
		models = append(models, huh.NewOption(p.title+"  ·  "+p.model, p.model))
	}
	if len(fields) == 0 {
		return errLater
	}
	model := w.value("LLM_PROVIDER")
	if !slices.ContainsFunc(models, func(o huh.Option[string]) bool { return o.Value == model }) {
		model = models[0].Value
	}
	fields = append(fields, huh.NewSelect[string]().
		Title("Default model").
		Description("Used where a task does not pick its own. Change it later in Admin > AI.").
		Options(models...).
		Value(&model))
	if err := w.form(huh.NewGroup(fields...)); err != nil {
		return err
	}
	for env, value := range answers {
		w.set(env, *value)
	}
	w.set("LLM_PROVIDER", model)
	return nil
}

func (w *wizard) mcpForm(in manifest.Integration) error {
	actions := w.value("CRATE_MCP_ACTIONS_ENABLED") == "true"
	public := w.cfg.Access == install.AccessCloudflare
	extra := "Agents connect with a token you create in Admin > Agents."
	if public {
		extra = "Agents such as Claude can also sign in with OAuth at " + w.cfg.PublicURLs().API + "/mcp."
	}
	err := w.form(huh.NewGroup(
		huh.NewNote().Title(in.Title).Description(in.Summary+"\n\n"+extra),
		huh.NewConfirm().
			Title("Let agents change things?").
			Description("Without this, agents only read: library, stats, health. With it, they can queue downloads, fix tags and run maintenance, always within the permissions of their token.").
			Affirmative("Yes").
			Negative("Read only").
			Value(&actions),
	))
	if err != nil {
		return err
	}
	w.draft().EnableMCP(actions)
	return nil
}

func (w *wizard) telegramForm(ctx context.Context, in manifest.Integration) error {
	token := w.value("TELEGRAM_BOT_TOKEN")
	err := w.form(huh.NewGroup(
		huh.NewNote().Title(in.Title).Description(guide(in)),
		huh.NewInput().Title("Bot token").EchoMode(huh.EchoModePassword).Value(&token),
	))
	if err != nil {
		return err
	}
	token = strings.TrimSpace(token)
	w.set("TELEGRAM_BOT_TOKEN", token)
	bot, result := w.validate.TelegramBot(ctx, token)
	if result.Status != validate.Valid {
		return nil
	}
	if w.value("TELEGRAM_CHAT_ID") != "" {
		return nil
	}
	sent := true
	err = w.form(huh.NewGroup(huh.NewConfirm().
		Title("Send @" + bot + " a message").
		Description("Open Telegram, find @" + bot + " and send it anything, for example /start. Crate replies to that chat.").
		Affirmative("I sent it").
		Negative("Enter the chat ID myself").
		Value(&sent)))
	if err != nil {
		return err
	}
	chat := ""
	if sent {
		ui.Spin(w.out, true, "Waiting for your message", func() error {
			deadline := time.Now().Add(60 * time.Second)
			for chat == "" && time.Now().Before(deadline) {
				chat, _ = w.validate.TelegramLatestChat(ctx, token)
				if chat == "" {
					time.Sleep(2 * time.Second)
				}
			}
			return nil
		})
	}
	if chat == "" {
		if err := w.form(huh.NewGroup(huh.NewInput().Title("Chat ID").Description("A number; @userinfobot tells you yours.").Value(&chat))); err != nil {
			return err
		}
	} else {
		ui.Success(w.out, "Found your chat")
	}
	w.set("TELEGRAM_CHAT_ID", chat)
	return nil
}

// reportIntegrations validates what --yes configured, without blocking.
func (w *wizard) reportIntegrations(ctx context.Context) {
	if w.value("SLSKD_URL") == install.BundledSlskdURL {
		if err := w.draft().UseBundledSlskd(); err != nil {
			ui.Warning(w.out, "Could not prepare Crate's slskd: "+err.Error())
		}
	}
	any := false
	for _, in := range w.ordered() {
		if !w.enabled(in) {
			continue
		}
		any = true
		result := w.validate.Check(ctx, in.ID, w.values(in))
		tone := ui.ToneOK
		if result.Status == validate.Rejected || result.Status == validate.Incomplete {
			tone = ui.ToneWarn
		}
		ui.StatusRow(w.out, tone, in.Title, result.Message, "")
	}
	if !any {
		ui.Success(w.out, "None configured. Add them later with `crate configure`.")
	}
}
