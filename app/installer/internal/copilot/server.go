package copilot

import (
	"context"
	"net/http"
	"os"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/system"
	"github.com/thecrateapp/crate/app/installer/internal/validate"
)

const Instructions = `You are installing Crate, a self-hosted music server, on the user's computer. Crate runs as Docker containers; these tools do the work, you guide the user.

How to work:
1. Call crate_status first. It checks the machine and lists next_steps. If Docker is missing, explain how to install it and get the user's approval before running anything.
2. Ask, one topic at a time, in plain language: where their music is, where Crate should keep its data (fast disk), the timezone, and how they will reach Crate (ports for this machine and their network; hosts or dnsmasq for a local name; cloudflare for public HTTPS with their own domain). Save answers with crate_set_basics and crate_set_access.
3. Call crate_integrations and suggest the recommended ones (Last.fm, Fanart.tv). Explain each in a sentence and let the user choose. Enable each with crate_set_integration, passing only non-secret values.
4. Secrets (API keys, tokens, passwords) are never typed in this chat. Call crate_request_secrets with the integrations that need keys, plus admin_password and cloudflare_token when relevant, and give the user the link. The page explains where to get each key and checks it. If the user pastes a secret in the chat anyway, do not repeat it; ask them to use the page.
5. When the user is happy, call crate_apply. If it returns privileged_commands, show them and run them only with the user's approval.
6. Call crate_start, then crate_progress until the phase is "ready" (the first download takes several minutes). Then call crate_credentials and give the user the link, and finish with crate_doctor.

Rules: confirm before crate_apply and crate_start; never invent settings the user did not choose; keep answers short; report failures with the fix the tools suggest. Re-running on an existing installation keeps its secrets.`

// NewServer builds the MCP server around a fresh session.
func NewServer(version string, deps Deps) (*mcp.Server, *Session, error) {
	m, err := manifest.Load()
	if err != nil {
		return nil, nil, err
	}
	session := NewSession(m, deps)
	server := mcp.NewServer(&mcp.Implementation{Name: "crate-installer", Title: "Crate installer", Version: version}, &mcp.ServerOptions{Instructions: Instructions})
	readOnly := &mcp.ToolAnnotations{ReadOnlyHint: true}
	mcp.AddTool(server, &mcp.Tool{Name: "crate_status", Description: "Where the installation stands: machine checks, settings (never secret values), integrations, start progress and the next steps to take. Call it first and whenever unsure.", Annotations: readOnly}, session.toolStatus)
	mcp.AddTool(server, &mcp.Tool{Name: "crate_integrations", Description: "Every optional integration with what it does, whether it is recommended, where the user gets its key and which settings are secret.", Annotations: readOnly}, session.toolIntegrations)
	mcp.AddTool(server, &mcp.Tool{Name: "crate_set_basics", Description: "Set the install folder, music library, data folder, timezone and instance name. Returns how many audio files the library holds."}, session.toolSetBasics)
	mcp.AddTool(server, &mcp.Tool{Name: "crate_set_access", Description: "Choose how Crate is reached: ports, hosts, dnsmasq or cloudflare, with the domain when needed."}, session.toolSetAccess)
	mcp.AddTool(server, &mcp.Tool{Name: "crate_set_integration", Description: "Turn an integration on or off and set its non-secret values. Secrets are rejected here: use crate_request_secrets."}, session.toolSetIntegration)
	mcp.AddTool(server, &mcp.Tool{Name: "crate_request_secrets", Description: "Create a private page on this computer where the user types API keys, tokens and the admin password. Returns the link for the user; you never see the values, only whether they were accepted (crate_status)."}, session.toolRequestSecrets)
	mcp.AddTool(server, &mcp.Tool{Name: "crate_check", Description: "Check every enabled integration's credentials against its provider again.", Annotations: readOnly}, session.toolCheck)
	mcp.AddTool(server, &mcp.Tool{Name: "crate_apply", Description: "Write the installation to disk: compose stack, settings and generated secrets. Existing secrets and manual edits are kept. Ask the user first."}, session.toolApply)
	mcp.AddTool(server, &mcp.Tool{Name: "crate_start", Description: "Download and start Crate in the background. Poll crate_progress."}, session.toolStart)
	mcp.AddTool(server, &mcp.Tool{Name: "crate_progress", Description: "Progress of crate_start: phase, elapsed time and the last log lines.", Annotations: readOnly}, session.toolProgress)
	mcp.AddTool(server, &mcp.Tool{Name: "crate_credentials", Description: "A private link that shows the user the addresses and the admin password. Give it to the user; do not open it.", Annotations: readOnly}, session.toolCredentials)
	mcp.AddTool(server, &mcp.Tool{Name: "crate_doctor", Description: "Full health check of an installation: machine, Docker, every service, the API and each configured key, with fixes.", Annotations: readOnly}, session.toolDoctor)
	return server, session, nil
}

func DefaultDeps() Deps {
	return Deps{
		Run:          system.ExecRunner{},
		Validate:     validate.NewClient(),
		HTTP:         &http.Client{Timeout: 5 * time.Second},
		DetectDocker: system.DetectDocker,
		Getenv:       os.Getenv,
	}
}

// Serve speaks MCP over stdin and stdout until the client disconnects.
func Serve(ctx context.Context, version string) error {
	server, session, err := NewServer(version, DefaultDeps())
	if err != nil {
		return err
	}
	defer session.Close()
	return server.Run(ctx, &mcp.StdioTransport{})
}

// Close stops the private page server.
func (s *Session) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.portal != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		s.portal.close(ctx)
	}
}
