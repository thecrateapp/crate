package copilot

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/thecrateapp/crate/app/installer/internal/agent"
	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/stack"
	"github.com/thecrateapp/crate/app/installer/internal/system"
	"github.com/thecrateapp/crate/app/installer/internal/validate"
)

// AgentRunning is the job's agent state when Crate Agent works.
const AgentRunning = "running"

var agentTimeout = 2 * time.Minute

// setAgent turns Crate Agent on. Callers hold s.mu.
func (s *Session) setAgent(ctx context.Context, in IntegrationInput) error {
	if agent.Wanted(s.existing) == agent.Operator {
		return errors.New("Crate Operator runs here; the user changes it with `" + agent.SetupCommand + "` in a terminal")
	}
	if mode, ok := agent.ParseMode(in.AgentMode); !ok || mode == agent.Operator {
		return errors.New(`agent_mode must be "agent"; Crate Operator is set up later by the user with ` + "`" + agent.SetupCommand + "` in a terminal")
	}
	d := s.draft()
	d.Set("CRATE_AGENT_MODE", string(agent.Agent))
	d.EnableMCP(d.Value("CRATE_MCP_ACTIONS_ENABLED") == "true")
	if !in.TelegramFindUsers {
		return nil
	}
	token := d.Value("AGENT_TELEGRAM_TOKEN")
	if token == "" {
		return errors.New("set the bot token first with crate_request_secrets")
	}
	users, err := s.deps.Validate.TelegramPrivateUsers(ctx, token)
	switch {
	case errors.Is(err, validate.ErrTelegramConflict):
		return errors.New("another program reads this bot's messages; the user stops it or creates a new bot")
	case err != nil:
		return fmt.Errorf("could not read the bot's messages: %w", err)
	case len(users) == 0:
		return errors.New("no private message reached the bot yet; ask everyone who may use it to send it one, then try again")
	}
	ids := make([]string, 0, len(users))
	for _, user := range users {
		ids = append(ids, strconv.FormatInt(user.ID, 10))
	}
	d.Set("AGENT_ALLOWED_USERS", strings.Join(ids, ","))
	return nil
}

// agentNeedsUsers is true while Crate Agent has a bot but nobody may use it.
func (s *Session) agentNeedsUsers() bool {
	d := s.draft()
	if agent.Mode(d.Value("CRATE_AGENT_MODE")) != agent.Agent || d.Value("AGENT_ALLOWED_USERS") != "" {
		return false
	}
	stored := agent.StoredSecrets(s.existing, agent.Agent)
	return !stored.Users && (d.Value("AGENT_TELEGRAM_TOKEN") != "" || stored.Bot)
}

// transient keeps the answers only the agent setup sees, which .env never holds.
func (s *Session) transient() map[string]string {
	kept := map[string]string{}
	for name := range s.manifest.Transient() {
		if value := s.cfg.Integrations[name]; value != "" {
			kept[name] = value
		}
	}
	return kept
}

// agentStep is the job's last phase when the agent has to be set up, turned
// off or switched; nil when it runs as the settings ask.
func (s *Session) agentStep(st stack.Stack, docker system.Docker, values *envfile.Values) func(context.Context, io.Writer) string {
	from, to := agent.Active(values), agent.Wanted(values)
	answers := s.transient()
	if from == to && (to == agent.Off || len(answers) == 0) {
		return nil
	}
	m := s.manifest
	return func(ctx context.Context, w io.Writer) string {
		setup := agent.Setup{Stack: st, Docker: docker.Docker}
		if err := setup.Transition(ctx, w, m, from, to, answers); err != nil {
			return "not set up (" + err.Error() + "); the user runs `" + agent.SetupCommand + "` in a terminal"
		}
		if to == agent.Off {
			return "off"
		}
		values, err := install.ReadExisting(st.Dir)
		if err != nil {
			return "not checked: " + err.Error()
		}
		status, err := setup.WaitReady(ctx, values, to, agentTimeout, 5*time.Second)
		switch {
		case err != nil:
			return "started but does not answer yet (" + err.Error() + "); call crate_doctor"
		case !status.Ready:
			return "started but cannot use Crate yet (" + status.MCP + "); call crate_doctor"
		case status.SignInPending:
			providerID, _ := values.Get("CRATE_AGENT_PROVIDER")
			provider, _ := agent.FindProvider(providerID)
			return "Sign-in pending: run `" + agent.SetupCommand + "` in a terminal (" + provider.SignIn + ")"
		}
		return AgentRunning
	}
}
