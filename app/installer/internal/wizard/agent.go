package wizard

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/huh"

	"github.com/thecrateapp/crate/app/installer/internal/agent"
	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/stack"
	"github.com/thecrateapp/crate/app/installer/internal/system"
	"github.com/thecrateapp/crate/app/installer/internal/ui"
	"github.com/thecrateapp/crate/app/installer/internal/validate"
)

const defaultApprover = "admin@cratemusic.app"

// agentState is what this run learned about the agent, for the closing screen.
type agentState struct {
	touched bool   // the user went through the agent form
	bot     string // the bot's username, when its token was checked
	signIn  string // product text of a sign-in still pending
	running bool
}

func (w *wizard) agentForm(ctx context.Context, in manifest.Integration) error {
	w.agent.touched = true
	current := agent.Wanted(w.existing)
	mode := agent.Agent
	if !w.configuring {
		if current == agent.Operator {
			ui.Success(w.out, "Crate Operator is set up. Change it with `"+agent.SetupCommand+"`.")
			return errLater
		}
	} else if chosen, err := w.chooseAgentMode(in, current); err != nil {
		return err
	} else if chosen == agent.Off {
		w.clear(in)
		return errLater
	} else {
		mode = chosen
	}
	stored := agent.StoredSecrets(w.existing, mode)
	previous := agent.StoredSecrets(w.existing, current)
	keepBot := stored.Bot || (current != agent.Off && previous.Bot)
	keepUsers := stored.Users || (current != agent.Off && previous.Users)

	token, err := w.askBot(ctx, in, keepBot)
	if err != nil {
		return err
	}
	users, err := w.askUsers(ctx, token, keepUsers)
	if err != nil {
		return err
	}
	if err := w.askModel(stored, previous); err != nil {
		return err
	}
	if mode == agent.Operator {
		if err := w.askApprover(users, current == agent.Operator); err != nil {
			return err
		}
	}
	w.set("CRATE_AGENT_MODE", string(mode))
	w.draft().EnableMCP(mode == agent.Operator || w.value("CRATE_MCP_ACTIONS_ENABLED") == "true")
	return nil
}

func (w *wizard) chooseAgentMode(in manifest.Integration, current agent.Mode) (agent.Mode, error) {
	mode := current
	if mode == agent.Off {
		mode = agent.Agent
	}
	options := []huh.Option[agent.Mode]{
		huh.NewOption("Crate Agent  ·  answers questions, changes nothing", agent.Agent),
		huh.NewOption("Crate Operator  ·  also makes changes you approve in Telegram", agent.Operator),
	}
	if current != agent.Off {
		options = append(options, huh.NewOption("Turn it off  ·  stops the bot and revokes its access", agent.Off))
	}
	description := in.Summary + "\n\nCrate Operator recreates Crate's services with its own settings and only applies changes while Crate runs official images."
	err := w.form(huh.NewGroup(
		huh.NewNote().Title(in.Title).Description(description),
		huh.NewSelect[agent.Mode]().Title("Which assistant?").Options(options...).Value(&mode),
	))
	return mode, err
}

// askBot returns the new bot token, or "" when the current bot stays.
func (w *wizard) askBot(ctx context.Context, in manifest.Integration, keepable bool) (string, error) {
	keep := keepable
	if keepable {
		err := w.form(huh.NewGroup(
			huh.NewNote().Title(in.Title).Description(in.Summary),
			huh.NewSelect[bool]().
				Title("Telegram bot").
				Options(huh.NewOption("Keep the current bot", true), huh.NewOption("Use a different bot", false)).
				Value(&keep),
		))
		if err != nil || keep {
			return "", err
		}
	}
	token := ""
	err := w.form(huh.NewGroup(
		huh.NewNote().Title(in.Title).Description(guide(in)),
		huh.NewInput().
			Title("Bot token").
			Description("BotFather sends it right after /newbot. Use a bot that no other program reads.").
			EchoMode(huh.EchoModePassword).
			Value(&token).
			Validate(func(value string) error {
				bot, result := w.validate.TelegramBot(ctx, strings.TrimSpace(value))
				switch result.Status {
				case validate.Rejected:
					return errors.New(result.Message)
				case validate.Valid:
					w.agent.bot = bot
				}
				return nil
			}),
	))
	if err != nil {
		return "", err
	}
	token = strings.TrimSpace(token)
	w.set("AGENT_TELEGRAM_TOKEN", token)
	return token, nil
}

// askUsers returns the allowed Telegram user IDs the user chose.
func (w *wizard) askUsers(ctx context.Context, token string, keepable bool) ([]string, error) {
	if keepable && token == "" {
		keep := true
		err := w.form(huh.NewGroup(huh.NewSelect[bool]().
			Title("Who may use the bot?").
			Options(huh.NewOption("Keep the current allowed users", true), huh.NewOption("Enter them again", false)).
			Value(&keep)))
		if err != nil || keep {
			return nil, err
		}
	}
	var found []validate.TelegramUser
	if token != "" {
		var err error
		if found, err = w.findTelegramUsers(ctx, token); err != nil {
			return nil, err
		}
	}
	var ids []string
	if len(found) > 0 {
		var options []huh.Option[string]
		for _, user := range found {
			id := strconv.FormatInt(user.ID, 10)
			options = append(options, huh.NewOption(user.Label(), id).Selected(true))
			ids = append(ids, id)
		}
		err := w.form(huh.NewGroup(huh.NewMultiSelect[string]().
			Title("Who may use the bot?").
			Description("Only these accounts get answers. Unselect anyone who should not.").
			Options(options...).
			Value(&ids)))
		if err != nil {
			return nil, err
		}
	}
	if len(ids) == 0 {
		manual := ""
		err := w.form(huh.NewGroup(huh.NewInput().
			Title("Telegram user IDs").
			Description("Numbers separated by commas. Each person gets theirs from @userinfobot.").
			Value(&manual).
			Validate(func(value string) error {
				if !agent.UsersPattern.MatchString(strings.ReplaceAll(value, " ", "")) {
					return errors.New("use numeric IDs such as 12345678,87654321")
				}
				return nil
			})))
		if err != nil {
			return nil, err
		}
		ids = strings.Split(strings.ReplaceAll(manual, " ", ""), ",")
	}
	w.set("AGENT_ALLOWED_USERS", strings.Join(ids, ","))
	return ids, nil
}

func (w *wizard) findTelegramUsers(ctx context.Context, token string) ([]validate.TelegramUser, error) {
	bot := "your bot"
	if w.agent.bot != "" {
		bot = "@" + w.agent.bot
	}
	sent := true
	err := w.form(huh.NewGroup(huh.NewConfirm().
		Title("Send " + bot + " a message from each account").
		Description("Everyone who may use the bot opens Telegram, finds " + bot + " and sends it any message, for example /start.").
		Affirmative("Done").
		Negative("Enter the IDs myself").
		Value(&sent)))
	if err != nil || !sent {
		return nil, err
	}
	var found []validate.TelegramUser
	var failure error
	ui.Spin(w.out, true, "Looking for the messages", func() error {
		deadline := time.Now().Add(w.telegramWait)
		for len(found) == 0 && failure == nil && time.Now().Before(deadline) {
			found, failure = w.validate.TelegramPrivateUsers(ctx, token)
			if len(found) == 0 && failure == nil {
				time.Sleep(2 * time.Second)
			}
		}
		return nil
	})
	switch {
	case errors.Is(failure, validate.ErrTelegramConflict):
		ui.Warning(w.out, "Another program reads this bot's messages. Stop it, or create a new bot for Crate.")
	case failure != nil:
		ui.Warning(w.out, "Could not read the bot's messages: "+failure.Error())
	case len(found) == 0:
		ui.Warning(w.out, "No message reached the bot yet.")
	}
	return found, nil
}

func (w *wizard) askModel(stored, previous agent.Stored) error {
	providerID := w.value("CRATE_AGENT_PROVIDER")
	if _, ok := agent.FindProvider(providerID); !ok || providerID == "" {
		providerID = agent.DefaultProvider
	}
	var options []huh.Option[string]
	for _, p := range agent.Providers {
		how := "API key"
		switch {
		case p.Key == agent.NoKey:
			how = "sign in"
		case p.SignIn != "":
			how = "API key or sign in"
		case p.BaseURL == agent.RequiredURL:
			how = "your own endpoint"
		}
		options = append(options, huh.NewOption(p.Title+ui.Muted.Render("  ·  "+how), p.ID))
	}
	err := w.form(huh.NewGroup(huh.NewSelect[string]().
		Title("Model").
		Description("The assistant answers with this model. You can change it later.").
		Options(options...).
		Value(&providerID)))
	if err != nil {
		return err
	}
	provider, _ := agent.FindProvider(providerID)
	model, baseURL := "", ""
	if providerID == w.value("CRATE_AGENT_PROVIDER") {
		model, baseURL = w.value("CRATE_AGENT_MODEL"), w.value("CRATE_AGENT_BASE_URL")
	}
	model = provider.Model(model)
	hasKey := stored.Key(providerID) || previous.Key(providerID)
	key := ""
	fields := []huh.Field{huh.NewInput().
		Title("Model name").
		Description("The provider's model id, for example claude-sonnet-5 or qwen3:32b.").
		Value(&model).
		Validate(func(value string) error {
			if problem := provider.Problem(strings.TrimSpace(value), ""); problem != "" && provider.BaseURL != agent.RequiredURL {
				return errors.New(problem)
			}
			return nil
		})}
	if provider.BaseURL != agent.NoURL {
		description := "Reachable from inside Docker: use this machine's LAN address, not localhost."
		if provider.BaseURL == agent.OptionalURL {
			description = "Leave it empty for the provider's own API."
		}
		fields = append(fields, huh.NewInput().Title("Base URL").Description(description).Placeholder("http://192.168.1.20:11434/v1").Value(&baseURL))
	}
	if provider.Key != agent.NoKey {
		description := "Get it at " + provider.KeyURL + ". It is stored for the assistant only, never in .env."
		switch {
		case hasKey:
			description = "Leave it empty to keep the stored key."
		case provider.SignIn != "":
			description = "Leave it empty to sign in with your account instead."
		case provider.Key == agent.OptionalKey:
			description = "Leave it empty if the endpoint needs none."
		}
		fields = append(fields, huh.NewInput().
			Title("API key").
			Description(description).
			EchoMode(huh.EchoModePassword).
			Value(&key).
			Validate(func(value string) error {
				value = strings.TrimSpace(value)
				switch {
				case value == "" && provider.Key == agent.RequiredKey && !hasKey:
					return errors.New(provider.Title + " needs an API key")
				case value != "" && !agent.ValidKey(value):
					return errors.New("an API key is one value without spaces")
				}
				return nil
			}))
	}
	if provider.SignIn != "" && provider.Key == agent.NoKey {
		fields = append([]huh.Field{huh.NewNote().Title(provider.Title).Description(provider.SignIn + " once Crate runs; the installer opens it for you.")}, fields...)
	}
	if err := w.form(huh.NewGroup(fields...)); err != nil {
		return err
	}
	w.set("CRATE_AGENT_PROVIDER", providerID)
	w.set("CRATE_AGENT_MODEL", strings.TrimSpace(model))
	w.set("CRATE_AGENT_BASE_URL", strings.TrimSpace(baseURL))
	if key = strings.TrimSpace(key); key != "" {
		w.set("AGENT_MODEL_API_KEY", key)
	}
	return nil
}

func (w *wizard) askApprover(users []string, bound bool) error {
	if bound {
		change := false
		err := w.form(huh.NewGroup(huh.NewConfirm().
			Title("Change who approves changes?").
			Description("Crate Operator applies a change only after this person presses Approve in Telegram.").
			Affirmative("Yes").
			Negative("Keep the current approver").
			Value(&change)))
		if err != nil || !change {
			return err
		}
	}
	email := defaultApprover
	fields := []huh.Field{huh.NewInput().
		Title("Approver").
		Description("Email of the Crate admin who approves changes. Their button press in Telegram is the approval.").
		Value(&email).
		Validate(func(value string) error {
			if !strings.Contains(value, "@") {
				return errors.New("enter the admin's email")
			}
			return nil
		})}
	telegram := ""
	if len(users) > 0 {
		telegram = users[0]
		var options []huh.Option[string]
		for _, id := range users {
			options = append(options, huh.NewOption(id, id))
		}
		fields = append(fields, huh.NewSelect[string]().Title("Their Telegram account").Options(options...).Value(&telegram))
	} else {
		fields = append(fields, huh.NewInput().Title("Their Telegram user ID").Description("One of the allowed users.").Value(&telegram))
	}
	if err := w.form(huh.NewGroup(fields...)); err != nil {
		return err
	}
	w.set("AGENT_APPROVER_EMAIL", strings.TrimSpace(email))
	w.set("AGENT_APPROVER_TELEGRAM_ID", strings.TrimSpace(telegram))
	return nil
}

// agentAnswers are the values only the setup step sees.
func (w *wizard) agentAnswers() map[string]string {
	answers := map[string]string{}
	for name := range w.manifest.Transient() {
		if value := w.cfg.Integrations[name]; value != "" {
			answers[name] = value
		}
	}
	return answers
}

// keepOperatorForConfigure leaves Crate Operator to `crate configure agent`.
func (w *wizard) keepOperatorForConfigure() {
	if agent.Mode(w.value("CRATE_AGENT_MODE")) != agent.Operator || agent.Wanted(w.existing) == agent.Operator {
		return
	}
	w.set("CRATE_AGENT_MODE", string(agent.Agent))
	ui.Warning(w.out, "Crate Operator is set up with `"+agent.SetupCommand+"` once Crate runs; installing Crate Agent now.")
}

// setUpAgent brings the agent to what the settings ask for, once Crate runs.
// A failure here leaves Crate running, so it is reported, not returned.
func (w *wizard) setUpAgent(ctx context.Context, s stack.Stack, api string) {
	values, err := install.ReadExisting(s.Dir)
	if err != nil || values == nil {
		return
	}
	from, to := agent.Active(values), agent.Wanted(values)
	answers := w.agentAnswers()
	changed := from != to || (to != agent.Off && len(answers) > 0)
	if !changed && (to == agent.Off || !w.agent.touched) {
		w.agent.running = to != agent.Off
		return
	}
	setup := agent.Setup{Stack: s, Docker: w.docker.Docker}
	title := "Setting up " + to.Name()
	if to == agent.Off {
		title = "Turning " + from.Name() + " off"
	}
	if changed {
		ui.Heading(w.out, title)
		if err := setup.Transition(ctx, w.out, w.manifest, from, to, answers); err != nil {
			ui.Failure(w.out, err.Error())
			ui.Warning(w.out, "Crate keeps running. Fix it with `"+agent.SetupCommand+"`.")
			return
		}
	}
	if to == agent.Off {
		ui.Success(w.out, from.Name()+" is off; its bot and its access to Crate are removed")
		return
	}
	if values, err = install.ReadExisting(s.Dir); err != nil {
		return
	}
	var status agent.Status
	err = ui.Spin(w.out, w.interactive(), "Waiting for "+to.Name()+" to reach Crate", func() error {
		if err := stack.WaitForAPI(ctx, &http.Client{Timeout: 5 * time.Second}, api, w.startupTimeout, time.Second); err != nil {
			return err
		}
		status, err = setup.WaitReady(ctx, values, to, w.agentTimeout, 5*time.Second)
		return err
	})
	switch {
	case err != nil:
		ui.Warning(w.out, to.Name()+" does not answer yet: "+err.Error()+". `crate doctor` shows its state.")
		return
	case !status.Ready:
		ui.Warning(w.out, to.Name()+" cannot use Crate yet ("+status.MCP+"). `crate doctor` shows its state.")
		return
	}
	w.agent.running = true
	providerID, _ := values.Get("CRATE_AGENT_PROVIDER")
	provider, _ := agent.FindProvider(providerID)
	if status.SignInPending {
		w.signIn(ctx, setup, values, to, provider)
		if status, err = setup.Check(ctx, values, to); err == nil && status.SignInPending {
			w.agent.signIn = provider.SignIn
			ui.Warning(w.out, "Sign-in pending: run `"+agent.SignInCommand+"` in a terminal")
			return
		}
	}
	err = ui.Spin(w.out, w.interactive(), "Asking the model for a first answer", func() error {
		return setup.Reply(ctx, values, to)
	})
	if err != nil {
		ui.Warning(w.out, to.Name()+" is running, but "+err.Error())
		return
	}
	ui.Success(w.out, to.Name()+" is running and answered")
}

func (w *wizard) signIn(ctx context.Context, setup agent.Setup, values *envfile.Values, mode agent.Mode, provider agent.Provider) {
	if provider.SignIn == "" || !w.interactive() || !ui.IsTerminal(os.Stdin) {
		return
	}
	now, err := w.confirm(provider.SignIn+" now?", mode.Name()+" answers with your account. The sign-in shows a link and a code to approve in your browser.", true)
	if err != nil || !now {
		return
	}
	ui.Heading(w.out, provider.SignIn)
	if err := setup.SignIn(ctx, values, mode, provider.ID, os.Stdin, os.Stdout); err != nil {
		ui.Warning(w.out, "The sign-in did not finish: "+err.Error())
	}
}

func (w *wizard) agentNextSteps() []string {
	if !w.agent.running {
		return nil
	}
	if w.agent.signIn != "" {
		return []string{"Sign-in pending: run `" + agent.SignInCommand + "` in a terminal (" + w.agent.signIn + ")"}
	}
	bot := "your bot"
	if w.agent.bot != "" {
		bot = "@" + w.agent.bot
	}
	return []string{fmt.Sprintf("Message %s on Telegram from an allowed account and ask how Crate is doing", bot)}
}

// signInOnly signs the running agent in to its model provider, without the
// rest of the agent form.
func (w *wizard) signInOnly(ctx context.Context, dir string) error {
	mode := agent.Active(w.existing)
	if mode == agent.Off {
		return errors.New("Crate Agent is not running; set it up with `" + agent.SetupCommand + "`")
	}
	providerID, _ := w.existing.Get("CRATE_AGENT_PROVIDER")
	provider, _ := agent.FindProvider(providerID)
	if provider.SignIn == "" {
		return errors.New(provider.Title + " uses an API key, so there is nothing to sign in to; change it with `" + agent.SetupCommand + "`")
	}
	w.host = system.DetectHost(ctx, w.run)
	docker, state := w.detectDocker(ctx, w.run, w.host)
	if state != system.DockerReady {
		return errors.New("Docker is not reachable; start it and run `" + agent.SignInCommand + "` again")
	}
	w.docker = docker
	s, err := w.stack(dir)
	if err != nil {
		return err
	}
	setup := agent.Setup{Stack: s, Docker: docker.Docker}
	status, err := setup.Check(ctx, w.existing, mode)
	if err != nil {
		return fmt.Errorf("%s does not answer: %w; `crate doctor` shows why", mode.Name(), err)
	}
	if !status.SignInPending {
		ui.Success(w.out, mode.Name()+" is already signed in to "+provider.Title)
		return nil
	}
	ui.Heading(w.out, provider.SignIn)
	if err := setup.SignIn(ctx, w.existing, mode, provider.ID, os.Stdin, os.Stdout); err != nil {
		return fmt.Errorf("the sign-in did not finish: %w", err)
	}
	if status, err = setup.Check(ctx, w.existing, mode); err != nil || status.SignInPending {
		ui.Warning(w.out, "The sign-in is still pending; run `"+agent.SignInCommand+"` to try again")
		return nil
	}
	ui.Success(w.out, "Signed in. "+mode.Name()+" can answer now")
	return nil
}
