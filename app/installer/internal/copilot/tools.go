package copilot

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/thecrateapp/crate/app/installer/internal/agent"
	"github.com/thecrateapp/crate/app/installer/internal/doctor"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/secrets"
	"github.com/thecrateapp/crate/app/installer/internal/stack"
	"github.com/thecrateapp/crate/app/installer/internal/system"
	"github.com/thecrateapp/crate/app/installer/internal/validate"
)

var statusNames = map[validate.Status]string{
	validate.Valid: "accepted", validate.Rejected: "rejected", validate.Unreachable: "provider did not answer",
	validate.Incomplete: "incomplete", validate.Skipped: "nothing to check",
}

type DirInput struct {
	Dir string `json:"dir,omitempty" jsonschema:"install folder; defaults to ~/crate or the folder used earlier in this session"`
}

type CheckOut struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
	Fix    string `json:"fix,omitempty"`
}

type IntegrationState struct {
	ID             string   `json:"id"`
	Title          string   `json:"title"`
	Enabled        bool     `json:"enabled"`
	SecretsMissing []string `json:"secrets_missing,omitempty"`
	Check          string   `json:"check,omitempty"`
	CheckMessage   string   `json:"check_message,omitempty"`
}

type Settings struct {
	MusicDir        string        `json:"music_dir"`
	DataDir         string        `json:"data_dir"`
	Timezone        string        `json:"timezone"`
	InstanceName    string        `json:"instance_name"`
	Access          string        `json:"access"`
	Domain          string        `json:"domain"`
	ListenURL       string        `json:"listen_url"`
	AdminURL        string        `json:"admin_url"`
	Ports           install.Ports `json:"ports"`
	CloudflareToken string        `json:"cloudflare_token"`
	AdminPassword   string        `json:"admin_password"`
}

type StatusOut struct {
	Dir          string             `json:"dir"`
	Installed    bool               `json:"installed"`
	Applied      bool               `json:"applied"`
	Machine      []CheckOut         `json:"machine"`
	Settings     Settings           `json:"settings"`
	Integrations []IntegrationState `json:"integrations"`
	Start        *jobState          `json:"start,omitempty"`
	NextSteps    []string           `json:"next_steps"`
}

func checkOut(c system.Check) CheckOut {
	return CheckOut{Name: c.Title, Status: map[system.Status]string{system.OK: "ok", system.Warn: "warn", system.Fail: "fail"}[c.Status], Detail: c.Detail, Fix: c.Fix}
}

// status describes the session without a single secret value. Callers hold s.mu.
func (s *Session) status(ctx context.Context) StatusOut {
	out := StatusOut{Dir: s.dir, Installed: s.existing != nil, Applied: s.applied}
	docker, state := s.docker(ctx)
	out.Machine = []CheckOut{
		checkOut(system.ArchitectureCheck(s.host)),
		checkOut(system.MemoryCheck(s.host)),
		checkOut(system.DiskCheck(s.dir)),
		checkOut(system.DockerCheck(state, docker, s.host)),
	}
	urls := s.cfg.PublicURLs()
	out.Settings = Settings{
		MusicDir: s.cfg.MusicDir, DataDir: s.cfg.DataDir, Timezone: s.cfg.Timezone, InstanceName: s.cfg.InstanceName,
		Access: string(s.cfg.Access), Domain: s.cfg.Domain, ListenURL: urls.Listen, AdminURL: urls.Admin, Ports: s.cfg.Ports,
		CloudflareToken: "not needed", AdminPassword: "will be generated and shown to the user on a private page",
	}
	if s.cfg.Access == install.AccessCloudflare {
		out.Settings.CloudflareToken = "missing"
		if s.cfg.CloudflareToken != "" {
			out.Settings.CloudflareToken = "set"
			if result, ok := s.checks["cloudflare"]; ok {
				out.Settings.CloudflareToken += ", " + statusNames[result.Status]
			}
		}
	}
	switch {
	case s.existing != nil && !s.adminChosen:
		out.Settings.AdminPassword = "kept from the existing installation"
	case s.adminChosen:
		out.Settings.AdminPassword = "chosen by the user"
	}
	d := s.draft()
	for _, in := range s.manifest.Integrations {
		state := IntegrationState{ID: in.ID, Title: in.Title, Enabled: d.Enabled(in)}
		if state.Enabled {
			for _, env := range secretFields(in, s) {
				if d.Value(env.Name) == "" && !optionalSecret(env, s) {
					state.SecretsMissing = append(state.SecretsMissing, env.Label)
				}
			}
			if result, ok := s.checks[in.ID]; ok {
				state.Check, state.CheckMessage = statusNames[result.Status], result.Message
			}
		}
		out.Integrations = append(out.Integrations, state)
	}
	if s.job != nil {
		state := s.job.state()
		out.Start = &state
	}
	out.NextSteps = s.nextSteps(out, state)
	return out
}

func (s *Session) nextSteps(out StatusOut, docker system.DockerState) []string {
	var steps []string
	if docker != system.DockerReady {
		steps = append(steps, "Docker is not ready ("+out.Machine[3].Detail+"). "+out.Machine[3].Fix+" Ask before installing anything.")
	}
	var missing []string
	for _, in := range out.Integrations {
		if len(in.SecretsMissing) > 0 {
			missing = append(missing, in.ID)
		}
	}
	if out.Settings.CloudflareToken == "missing" {
		missing = append(missing, CloudflareTokenKey)
	}
	if len(missing) > 0 {
		steps = append(steps, "Call crate_request_secrets with "+strings.Join(missing, ", ")+" and send the user the link.")
	}
	if s.agentNeedsUsers() {
		steps = append(steps, "Ask everyone who may use the Crate Agent bot to send it a private message on Telegram, then call crate_set_integration with id agent and telegram_find_users true.")
	}
	if !out.Installed && out.Start == nil {
		topics := map[string]string{
			"basics":       "where the music is, where Crate keeps its data and the timezone (crate_set_basics)",
			"access":       "how they will reach Crate (crate_set_access)",
			"integrations": "which integrations they want (crate_integrations, then crate_set_integration)",
		}
		for _, topic := range []string{"basics", "access", "integrations"} {
			if !s.answered[topic] {
				steps = append(steps, "Ask the user "+topics[topic]+".")
			}
		}
	}
	switch {
	case out.Start != nil && out.Start.Phase == PhaseReady:
		steps = append(steps, "Crate is running. Call crate_credentials and give the user the link, then crate_doctor.")
		switch agentState := out.Start.Agent; {
		case strings.HasPrefix(agentState, "Sign-in pending"):
			steps = append(steps, "Tell the user, word for word: "+agentState+".")
		case agentState == AgentRunning:
			steps = append(steps, "Crate Agent runs: tell the user to message their bot on Telegram from an allowed account.")
		case agentState != "":
			steps = append(steps, "Crate Agent: "+agentState+".")
		}
	case out.Start != nil && out.Start.Phase == PhaseFailed:
		steps = append(steps, "Starting failed: "+out.Start.Error+". Call crate_doctor to see why.")
	case out.Start != nil:
		steps = append(steps, "Crate is starting ("+out.Start.Phase+"). Call crate_progress every 30 seconds or so.")
	case !out.Applied:
		steps = append(steps, "When the user is happy with the settings, call crate_apply, then crate_start.")
	default:
		steps = append(steps, "The files are written. Call crate_start to download and start Crate, or crate_doctor if it already runs.")
	}
	return steps
}

func (s *Session) lockAndUse(ctx context.Context, dir string) (func(), error) {
	s.mu.Lock()
	if err := s.use(ctx, dir); err != nil {
		s.mu.Unlock()
		return nil, err
	}
	return s.mu.Unlock, nil
}

func (s *Session) toolStatus(ctx context.Context, _ *mcp.CallToolRequest, in DirInput) (*mcp.CallToolResult, StatusOut, error) {
	unlock, err := s.lockAndUse(ctx, in.Dir)
	if err != nil {
		return nil, StatusOut{}, err
	}
	defer unlock()
	return nil, s.status(ctx), nil
}

type CatalogEntry struct {
	ID          string        `json:"id"`
	Group       string        `json:"group"`
	Title       string        `json:"title"`
	Summary     string        `json:"summary"`
	Recommended bool          `json:"recommended"`
	KeyURL      string        `json:"key_url,omitempty"`
	Steps       []string      `json:"steps,omitempty"`
	Fields      []CatalogItem `json:"fields"`
	Options     string        `json:"options,omitempty"`
}

type CatalogItem struct {
	Env     string `json:"env"`
	Label   string `json:"label"`
	Secret  bool   `json:"secret"`
	Default string `json:"default,omitempty"`
}

type CatalogOut struct {
	Integrations []CatalogEntry `json:"integrations"`
}

var integrationOptions = map[string]string{
	"soulseek": `crate_set_integration option "soulseek": "bundled" (Crate runs slskd; ask the user for a Soulseek username here and the password through crate_request_secrets) or "external" (their own slskd: set SLSKD_URL, ask for the API key through crate_request_secrets).`,
	"ai":       `Set OLLAMA_URL (default http://host.docker.internal:11434) and LLM_PROVIDER, for example gemini/gemini-2.5-flash, openai/gpt-4o-mini, anthropic/claude-sonnet-5-5 or ollama/llama3.1:8b. Ask for provider keys through crate_request_secrets.`,
	"mcp":      `crate_set_integration option "mcp_actions": true lets agents change things, false keeps them read-only. OAuth is configured automatically with public HTTPS.`,
	"tidal":    `Nothing to set now. After Crate starts, the user connects Tidal in Admin > Settings > Downloads with a code at tidal.com/activate.`,
	"agent":    `Crate Agent is a Telegram bot that answers questions about this Crate and changes nothing. Set CRATE_AGENT_PROVIDER: openai-codex (default; the user signs in with a ChatGPT account after Crate starts), openai-api, anthropic, openrouter, gemini or deepseek (API key), nous (API key or sign-in) or custom (an OpenAI-compatible endpoint: set CRATE_AGENT_BASE_URL). CRATE_AGENT_MODEL is required except for openai-codex. The user creates a new bot with @BotFather; ask for its token and the model key through crate_request_secrets. Then ask everyone who may use the bot to message it and call crate_set_integration with telegram_find_users true. Crate Operator, which can make changes, is set up later by the user with crate configure agent in a terminal.`,
}

func (s *Session) toolIntegrations(context.Context, *mcp.CallToolRequest, struct{}) (*mcp.CallToolResult, CatalogOut, error) {
	var out CatalogOut
	for _, in := range s.manifest.Integrations {
		entry := CatalogEntry{ID: in.ID, Group: in.Group, Title: in.Title, Summary: in.Summary, Recommended: in.Recommended, KeyURL: in.GetKey.URL, Steps: in.GetKey.Steps, Options: integrationOptions[in.ID]}
		for _, env := range in.Env {
			entry.Fields = append(entry.Fields, CatalogItem{Env: env.Name, Label: env.Label, Secret: env.Secret, Default: env.Default})
		}
		out.Integrations = append(out.Integrations, entry)
	}
	return nil, out, nil
}

type BasicsInput struct {
	Dir          string `json:"dir,omitempty" jsonschema:"install folder"`
	MusicDir     string `json:"music_dir,omitempty" jsonschema:"folder with the user's albums"`
	DataDir      string `json:"data_dir,omitempty" jsonschema:"folder for Crate's database, cache and artwork"`
	Timezone     string `json:"timezone,omitempty" jsonschema:"IANA timezone such as Europe/Madrid"`
	InstanceName string `json:"instance_name,omitempty" jsonschema:"how this Crate introduces itself"`
}

type LibraryOut struct {
	Exists bool   `json:"exists"`
	Files  int    `json:"audio_files"`
	Size   string `json:"size"`
	Note   string `json:"note,omitempty"`
}

type BasicsOut struct {
	Settings Settings   `json:"settings"`
	Library  LibraryOut `json:"library"`
}

func (s *Session) toolSetBasics(ctx context.Context, _ *mcp.CallToolRequest, in BasicsInput) (*mcp.CallToolResult, BasicsOut, error) {
	unlock, err := s.lockAndUse(ctx, in.Dir)
	if err != nil {
		return nil, BasicsOut{}, err
	}
	defer unlock()
	for target, value := range map[*string]string{&s.cfg.MusicDir: in.MusicDir, &s.cfg.DataDir: in.DataDir} {
		if value == "" {
			continue
		}
		path, err := absolute(value)
		if err != nil {
			return nil, BasicsOut{}, err
		}
		*target = path
	}
	if in.Timezone != "" {
		if _, err := time.LoadLocation(in.Timezone); err != nil {
			return nil, BasicsOut{}, fmt.Errorf("unknown timezone %q; use an IANA name such as Europe/Madrid", in.Timezone)
		}
		s.cfg.Timezone = in.Timezone
	}
	if in.InstanceName != "" {
		s.cfg.InstanceName = in.InstanceName
	}
	s.changed()
	s.answered["basics"] = true
	summary := install.SummarizeLibrary(s.cfg.MusicDir, 3*time.Second)
	library := LibraryOut{Exists: summary.Exists, Files: summary.Files, Size: fmt.Sprintf("%.1f GB", float64(summary.Bytes)/(1<<30))}
	switch {
	case !summary.Exists:
		library.Note = "The folder does not exist yet; Crate creates it and the user can copy albums there later."
	case !summary.Complete:
		library.Note = "Counting stopped after 3 seconds; there are more files."
	}
	return nil, BasicsOut{Settings: s.status(ctx).Settings, Library: library}, nil
}

type AccessInput struct {
	Mode   string         `json:"mode" jsonschema:"ports, hosts, dnsmasq or cloudflare"`
	Domain string         `json:"domain,omitempty" jsonschema:"local domain for hosts and dnsmasq (default crate.local), or the user's domain for cloudflare"`
	Ports  *install.Ports `json:"ports,omitempty" jsonschema:"only to move off the defaults (HTTP 80, HTTPS 443, API 8585, Admin 8580, Listen 8581)"`
}

func (s *Session) toolSetAccess(ctx context.Context, _ *mcp.CallToolRequest, in AccessInput) (*mcp.CallToolResult, Settings, error) {
	unlock, err := s.lockAndUse(ctx, "")
	if err != nil {
		return nil, Settings{}, err
	}
	defer unlock()
	mode, err := install.ParseAccessMode(in.Mode)
	if err != nil {
		return nil, Settings{}, err
	}
	domain := in.Domain
	switch mode {
	case install.AccessPorts:
		domain = "localhost"
	case install.AccessHosts, install.AccessDNSMasq:
		if domain == "" {
			domain = install.LocalDomainDefault
		}
	case install.AccessCloudflare:
		if domain == "" {
			return nil, Settings{}, errors.New("cloudflare access needs the user's domain")
		}
	}
	if err := install.ValidateDomain(domain); err != nil {
		return nil, Settings{}, fmt.Errorf("domain %q: %w", domain, err)
	}
	s.cfg.Access, s.cfg.Domain = mode, domain
	s.answered["access"] = true
	if in.Ports != nil {
		s.cfg.Ports = *in.Ports
	}
	if s.draft().Value("CRATE_MCP_ENABLED") == "true" {
		s.draft().EnableMCP(s.draft().Value("CRATE_MCP_ACTIONS_ENABLED") == "true")
	}
	s.changed()
	return nil, s.status(ctx).Settings, nil
}

type IntegrationInput struct {
	ID                string            `json:"id" jsonschema:"integration id from crate_integrations"`
	Enabled           bool              `json:"enabled" jsonschema:"false turns the integration off and clears its settings"`
	Values            map[string]string `json:"values,omitempty" jsonschema:"non-secret variables only, such as SLSKD_URL or LLM_PROVIDER; secrets go through crate_request_secrets"`
	Soulseek          string            `json:"soulseek,omitempty" jsonschema:"bundled or external"`
	MCPActions        bool              `json:"mcp_actions,omitempty" jsonschema:"let agents change things, not only read"`
	AgentMode         string            `json:"agent_mode,omitempty" jsonschema:"agent: Crate Agent, read only (the only mode the installer sets up)"`
	TelegramFindUsers bool              `json:"telegram_find_users,omitempty" jsonschema:"fill AGENT_ALLOWED_USERS with everyone who sent the Crate Agent bot a private message"`
}

func (s *Session) toolSetIntegration(ctx context.Context, _ *mcp.CallToolRequest, in IntegrationInput) (*mcp.CallToolResult, IntegrationState, error) {
	unlock, err := s.lockAndUse(ctx, "")
	if err != nil {
		return nil, IntegrationState{}, err
	}
	defer unlock()
	integration, ok := s.manifest.Integration(in.ID)
	if !ok {
		return nil, IntegrationState{}, fmt.Errorf("unknown integration %q; call crate_integrations", in.ID)
	}
	if in.ID == "agent" && agent.Wanted(s.existing) == agent.Operator {
		return nil, IntegrationState{}, errors.New("Crate Operator runs here; the user changes it with `" + agent.SetupCommand + "` in a terminal")
	}
	d := s.draft()
	s.changed()
	s.answered["integrations"] = true
	if !in.Enabled {
		d.Clear(integration)
		delete(s.checks, in.ID)
		return nil, s.integrationState(in.ID), nil
	}
	for env, value := range in.Values {
		known := slices.IndexFunc(integration.Env, func(e manifest.IntegrationEnv) bool { return e.Name == env })
		if known < 0 {
			return nil, IntegrationState{}, fmt.Errorf("%s is not a setting of %s", env, integration.Title)
		}
		if integration.Env[known].Secret {
			return nil, IntegrationState{}, fmt.Errorf("%s is a secret: call crate_request_secrets so the user types it privately, and never ask for it in the chat", env)
		}
		d.Set(env, value)
	}
	for _, env := range integration.Env {
		if env.Default != "" && d.Value(env.Name) == "" {
			d.Set(env.Name, env.Default)
		}
	}
	switch in.ID {
	case "soulseek":
		switch in.Soulseek {
		case "bundled", "":
			if err := d.UseBundledSlskd(); err != nil {
				return nil, IntegrationState{}, err
			}
		case "external":
			d.UseExternalSlskd()
		default:
			return nil, IntegrationState{}, errors.New(`soulseek must be "bundled" or "external"`)
		}
	case "mcp":
		d.EnableMCP(in.MCPActions)
	case "agent":
		if err := s.setAgent(ctx, in); err != nil {
			return nil, IntegrationState{}, err
		}
	}
	if !d.Enabled(integration) && in.ID != "tidal" {
		return nil, s.integrationState(in.ID), nil
	}
	if allSet(d, secretFields(integration, s), s) {
		s.check(ctx, integration)
	}
	return nil, s.integrationState(in.ID), nil
}

func allSet(d install.Draft, envs []manifest.IntegrationEnv, s *Session) bool {
	for _, env := range envs {
		if d.Value(env.Name) == "" && !optionalSecret(env, s) {
			return false
		}
	}
	return true
}

func (s *Session) integrationState(id string) IntegrationState {
	for _, state := range s.status(context.Background()).Integrations {
		if state.ID == id {
			return state
		}
	}
	return IntegrationState{ID: id}
}

type SecretsInput struct {
	Items []string `json:"items" jsonschema:"integration ids, admin_password and/or cloudflare_token"`
}

type SecretsOut struct {
	URL         string   `json:"url"`
	Items       []string `json:"items"`
	Instruction string   `json:"instruction"`
}

func (s *Session) toolRequestSecrets(ctx context.Context, _ *mcp.CallToolRequest, in SecretsInput) (*mcp.CallToolResult, SecretsOut, error) {
	unlock, err := s.lockAndUse(ctx, "")
	if err != nil {
		return nil, SecretsOut{}, err
	}
	defer unlock()
	if len(in.Items) == 0 {
		return nil, SecretsOut{}, errors.New("name at least one item")
	}
	blocks, err := s.blocksFor(in.Items)
	if err != nil {
		return nil, SecretsOut{}, err
	}
	p, err := s.startPortal()
	if err != nil {
		return nil, SecretsOut{}, err
	}
	return nil, SecretsOut{
		URL:         p.newRequest(blocks),
		Items:       in.Items,
		Instruction: "Give the user this link to open in a browser on this computer. It explains where to get each key; the user types them there and sees whether they work. Do not ask for the values in the chat. When the user says they are done, call crate_status to see which were accepted. The link works for 30 minutes.",
	}, nil
}

type ChecksOut struct {
	Results []IntegrationState `json:"results"`
}

func (s *Session) toolCheck(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, ChecksOut, error) {
	unlock, err := s.lockAndUse(ctx, "")
	if err != nil {
		return nil, ChecksOut{}, err
	}
	defer unlock()
	var out ChecksOut
	for _, in := range s.manifest.Integrations {
		if s.draft().Enabled(in) {
			s.check(ctx, in)
			out.Results = append(out.Results, s.integrationState(in.ID))
		}
	}
	return nil, out, nil
}

type ApplyOut struct {
	Written             []string `json:"written"`
	PrivilegedCommands  []string `json:"privileged_commands,omitempty"`
	PrivilegedGuidance  string   `json:"privileged_guidance,omitempty"`
	AdminPasswordSource string   `json:"admin_password"`
}

func (s *Session) toolApply(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, ApplyOut, error) {
	unlock, err := s.lockAndUse(ctx, "")
	if err != nil {
		return nil, ApplyOut{}, err
	}
	defer unlock()
	if s.existing == nil && s.cfg.AdminPassword == "" {
		password, err := secrets.Password()
		if err != nil {
			return nil, ApplyOut{}, err
		}
		s.cfg.AdminPassword, s.cfg.AdminPasswordGenerated = password, true
	}
	s.cfg.DockerGID = system.SocketGroup(ctx, s.deps.Run, s.host)
	if err := install.Apply(s.manifest, s.cfg, s.existing); err != nil {
		return nil, ApplyOut{}, err
	}
	existing, err := install.ReadExisting(s.dir)
	if err != nil {
		return nil, ApplyOut{}, err
	}
	s.existing, s.applied = existing, true
	s.cfg.Integrations, s.cfg.Profiles = s.transient(), nil
	out := ApplyOut{AdminPasswordSource: s.status(ctx).Settings.AdminPassword}
	for _, action := range install.Plan(s.cfg) {
		out.Written = append(out.Written, action.Path)
	}
	commands, err := install.LocalNameCommands(s.cfg, install.DetectDNSHost(ctx, s.deps.Run, s.host))
	if err != nil {
		return nil, ApplyOut{}, err
	}
	for _, c := range commands {
		out.PrivilegedCommands = append(out.PrivilegedCommands, strings.Join(c.Argv, " ")+"    # "+c.Description)
	}
	if len(commands) > 0 {
		out.PrivilegedGuidance = "These make the local domain resolve. Show them to the user and run them only with their approval; sudo asks for their password."
	}
	return nil, out, nil
}

func (s *Session) toolStart(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, jobState, error) {
	unlock, err := s.lockAndUse(ctx, "")
	if err != nil {
		return nil, jobState{}, err
	}
	defer unlock()
	if !s.applied {
		return nil, jobState{}, errors.New("there are unsaved changes; call crate_apply first")
	}
	if s.job != nil && s.job.running() {
		return nil, s.job.state(), nil
	}
	docker, state := s.docker(ctx)
	if state != system.DockerReady {
		check := system.DockerCheck(state, docker, s.host)
		return nil, jobState{}, errors.New("Docker is not ready: " + check.Detail + ". " + check.Fix)
	}
	values, err := install.ReadExisting(s.dir)
	if err != nil {
		return nil, jobState{}, err
	}
	st := stack.Stack{Run: s.deps.Run, Compose: docker.Compose, Dir: s.dir, Files: install.ComposeFiles(values)}
	s.job = startJob(st, s.deps.HTTP, s.cfg.LocalURLs().API, startTimeout, s.agentStep(st, docker, values))
	return nil, s.job.state(), nil
}

var startTimeout = 15 * time.Minute

func (s *Session) toolProgress(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, jobState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.job == nil {
		return nil, jobState{}, errors.New("nothing is starting; call crate_start")
	}
	return nil, s.job.state(), nil
}

type CredentialsOut struct {
	URL         string `json:"url"`
	Instruction string `json:"instruction"`
}

func (s *Session) toolCredentials(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, CredentialsOut, error) {
	unlock, err := s.lockAndUse(ctx, "")
	if err != nil {
		return nil, CredentialsOut{}, err
	}
	defer unlock()
	p, err := s.startPortal()
	if err != nil {
		return nil, CredentialsOut{}, err
	}
	return nil, CredentialsOut{URL: p.credentialsURL(), Instruction: "Give the user this link; it shows the Listen and Admin addresses and the admin password. Do not open it yourself or repeat the password."}, nil
}

func (s *Session) toolDoctor(ctx context.Context, _ *mcp.CallToolRequest, in DirInput) (*mcp.CallToolResult, doctor.Report, error) {
	unlock, err := s.lockAndUse(ctx, in.Dir)
	if err != nil {
		return nil, doctor.Report{}, err
	}
	dir := s.dir
	unlock()
	return nil, mustDoctor(ctx, dir, s.deps), nil
}

func mustDoctor(ctx context.Context, dir string, deps Deps) doctor.Report {
	report, err := doctor.Run(ctx, dir, doctor.Deps{Run: deps.Run, Validate: deps.Validate, HTTP: deps.HTTP, DetectDocker: deps.DetectDocker})
	if err != nil {
		return doctor.Report{Items: []doctor.Item{{Section: "Doctor", Name: "Run", Status: doctor.Fail, Detail: err.Error()}}}
	}
	return report
}
