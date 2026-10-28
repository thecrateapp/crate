package copilot

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"html/template"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/thecrateapp/crate/app/installer/internal/agent"
	"github.com/thecrateapp/crate/app/installer/internal/install"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/validate"
)

const requestLifetime = 30 * time.Minute

// Portal keys that are not .env variables of an integration.
const (
	AdminPasswordKey   = "admin_password"
	CloudflareTokenKey = "cloudflare_token"
)

// portal is the private channel to the user: secrets in, credentials out.
// It listens on 127.0.0.1 only, and every page needs an unguessable id.
type portal struct {
	mu          sync.Mutex
	session     *Session
	base        string
	server      *http.Server
	requests    map[string]*secretRequest
	credentials string
}

type field struct {
	Key, Label string
	Multiline  bool
}

type block struct {
	ID, Title, Summary, URL string
	Steps                   []string
	Fields                  []field
}

type secretRequest struct {
	blocks  []block
	expires time.Time
}

func randomID() string {
	data := make([]byte, 16)
	rand.Read(data)
	return hex.EncodeToString(data)
}

// startPortal starts the page server once. Callers hold s.mu.
func (s *Session) startPortal() (*portal, error) {
	if s.portal != nil {
		return s.portal, nil
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	p := &portal{session: s, base: "http://" + listener.Addr().String(), requests: map[string]*secretRequest{}, credentials: randomID()}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /r/{id}", p.showRequest)
	mux.HandleFunc("POST /r/{id}", p.submitRequest)
	mux.HandleFunc("GET /c/{id}", p.showCredentials)
	p.server = &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go p.server.Serve(listener)
	s.portal = p
	return p, nil
}

// blocksFor turns requested keys into form sections with their guides.
func (s *Session) blocksFor(keys []string) ([]block, error) {
	var blocks []block
	for _, key := range keys {
		switch key {
		case AdminPasswordKey:
			blocks = append(blocks, block{ID: key, Title: "Admin password", Summary: "You sign in to Admin and Listen as admin@cratemusic.app with this password. Use at least 8 characters.", Fields: []field{{Key: key, Label: "Password"}}})
			continue
		case CloudflareTokenKey:
			blocks = append(blocks, block{ID: key, Title: "Cloudflare API token", Summary: "Crate proves it owns your domain through Cloudflare's DNS to get free HTTPS certificates.", URL: "https://dash.cloudflare.com/profile/api-tokens", Steps: []string{"Create Token and use the \"Edit zone DNS\" template.", "Zone Resources: include the zone of your domain.", "Create the token and paste it here."}, Fields: []field{{Key: key, Label: "Token"}}})
			continue
		}
		in, ok := s.manifest.Integration(key)
		if !ok {
			return nil, errors.New("unknown item " + key + "; use an integration id, " + AdminPasswordKey + " or " + CloudflareTokenKey)
		}
		b := block{ID: in.ID, Title: in.Title, Summary: in.Summary, URL: in.GetKey.URL, Steps: in.GetKey.Steps}
		for _, env := range secretFields(in, s) {
			b.Fields = append(b.Fields, field{Key: env.Name, Label: env.Label, Multiline: env.Name == "APPLE_PRIVATE_KEY"})
		}
		if len(b.Fields) == 0 {
			return nil, errors.New(in.Title + " has no secret to ask for; set its values with crate_set_integration")
		}
		blocks = append(blocks, b)
	}
	return blocks, nil
}

// secretFields are the variables of in that only the user may enter. For
// Crate's own slskd the API key is generated, so only the account password is asked.
// Crate Agent asks for what it has not stored yet, and for a model key only
// when the provider takes one.
func secretFields(in manifest.Integration, s *Session) []manifest.IntegrationEnv {
	var envs []manifest.IntegrationEnv
	d := s.draft()
	stored := agent.StoredSecrets(s.existing, agent.Agent)
	provider, _ := agent.FindProvider(d.Value("CRATE_AGENT_PROVIDER"))
	for _, env := range in.Env {
		if !env.Secret {
			continue
		}
		switch {
		case env.Name == "SLSKD_API_KEY" && d.Value("SLSKD_URL") == install.BundledSlskdURL,
			env.Name == "SLSKD_SLSK_PASSWORD" && d.Value("SLSKD_URL") != install.BundledSlskdURL,
			env.Name == "AGENT_TELEGRAM_TOKEN" && stored.Bot,
			env.Name == "AGENT_MODEL_API_KEY" && (provider.Key == agent.NoKey || stored.Key(provider.ID)):
			continue
		}
		envs = append(envs, env)
	}
	return envs
}

// optionalSecret is a secret the integration works without.
func optionalSecret(env manifest.IntegrationEnv, s *Session) bool {
	provider, _ := agent.FindProvider(s.draft().Value("CRATE_AGENT_PROVIDER"))
	return env.Name == "AGENT_MODEL_API_KEY" && provider.Key == agent.OptionalKey
}

func (p *portal) newRequest(blocks []block) string {
	p.mu.Lock()
	defer p.mu.Unlock()
	id := randomID()
	p.requests[id] = &secretRequest{blocks: blocks, expires: time.Now().Add(requestLifetime)}
	return p.base + "/r/" + id
}

func (p *portal) request(id string) (*secretRequest, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	r, ok := p.requests[id]
	if !ok || time.Now().After(r.expires) {
		return nil, false
	}
	return r, true
}

type outcome struct {
	OK      bool
	Message string
}

type pageData struct {
	Title    string
	Blocks   []block
	Outcomes map[string]*outcome
	Saved    bool
	Rows     [][2]string
	Note     string
}

func (p *portal) showRequest(w http.ResponseWriter, r *http.Request) {
	request, ok := p.request(r.PathValue("id"))
	if !ok {
		http.Error(w, "This link has expired. Ask the agent for a new one.", http.StatusNotFound)
		return
	}
	render(w, pageData{Title: "Crate · private settings", Blocks: request.blocks})
}

func (p *portal) submitRequest(w http.ResponseWriter, r *http.Request) {
	request, ok := p.request(r.PathValue("id"))
	if !ok {
		http.Error(w, "This link has expired. Ask the agent for a new one.", http.StatusNotFound)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "Could not read the form.", http.StatusBadRequest)
		return
	}
	values := map[string]string{}
	for _, b := range request.blocks {
		for _, f := range b.Fields {
			if value := r.PostFormValue(f.Key); value != "" {
				values[f.Key] = value
			}
		}
	}
	outcomes := p.session.receive(r.Context(), request.blocks, values)
	render(w, pageData{Title: "Crate · private settings", Blocks: request.blocks, Outcomes: outcomes, Saved: len(values) > 0})
}

// receive stores what the user typed and checks every block it touched.
func (s *Session) receive(ctx context.Context, blocks []block, values map[string]string) map[string]*outcome {
	s.mu.Lock()
	defer s.mu.Unlock()
	outcomes := map[string]*outcome{}
	for _, b := range blocks {
		touched := false
		for _, f := range b.Fields {
			if _, ok := values[f.Key]; ok {
				touched = true
			}
		}
		if !touched {
			continue
		}
		s.changed()
		switch b.ID {
		case AdminPasswordKey:
			if len(values[AdminPasswordKey]) < 8 {
				outcomes[b.ID] = &outcome{false, "Use at least 8 characters."}
				continue
			}
			s.cfg.AdminPassword, s.cfg.AdminPasswordGenerated, s.adminChosen = values[AdminPasswordKey], false, true
			outcomes[b.ID] = &outcome{true, "Saved."}
		case CloudflareTokenKey:
			s.cfg.CloudflareToken = values[CloudflareTokenKey]
			err := s.deps.Validate.CloudflareToken(ctx, s.cfg.CloudflareToken)
			result := validate.Result{Status: validate.Valid, Message: "Cloudflare accepted the token"}
			if errors.Is(err, validate.ErrRejected) {
				result = validate.Result{Status: validate.Rejected, Message: "Cloudflare says this token is not active"}
			} else if err != nil {
				result = validate.Result{Status: validate.Unreachable, Message: err.Error()}
			}
			s.checks["cloudflare"] = result
			outcomes[b.ID] = &outcome{result.Status == validate.Valid, result.Message}
		default:
			for _, f := range b.Fields {
				if value, ok := values[f.Key]; ok {
					s.draft().Set(f.Key, value)
				}
			}
			in, _ := s.manifest.Integration(b.ID)
			result := s.check(ctx, in)
			ok := result.Status == validate.Valid || result.Status == validate.Skipped
			message := result.Message
			if result.Status == validate.Unreachable {
				message += ". Saved anyway; Crate retries when it runs."
			}
			outcomes[b.ID] = &outcome{ok, message}
		}
	}
	return outcomes
}

func (p *portal) credentialsURL() string {
	return p.base + "/c/" + p.credentials
}

func (p *portal) showCredentials(w http.ResponseWriter, r *http.Request) {
	if r.PathValue("id") != p.credentials {
		http.NotFound(w, r)
		return
	}
	s := p.session
	s.mu.Lock()
	password := "the one you chose"
	if s.existing != nil && s.cfg.AdminPassword == "" {
		password = "unchanged from your existing installation"
	} else if s.cfg.AdminPassword != "" {
		password = s.cfg.AdminPassword
	}
	urls := s.cfg.PublicURLs()
	s.mu.Unlock()
	render(w, pageData{
		Title: "Crate · sign in",
		Rows:  [][2]string{{"Listen", urls.Listen}, {"Admin", urls.Admin}, {"Email", "admin@cratemusic.app"}, {"Password", password}},
		Note:  "Save the password in your password manager. It is also DEFAULT_ADMIN_PASSWORD in your install folder's .env.",
	})
}

func (p *portal) close(ctx context.Context) {
	p.server.Shutdown(ctx)
}

func render(w http.ResponseWriter, data pageData) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	page.Execute(w, data)
}

var page = template.Must(template.New("page").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{.Title}}</title>
<style>
:root{color-scheme:dark}
body{margin:0;background:#0a0a0f;color:#f1f5f9;font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:640px;margin:0 auto;padding:48px 20px 64px}
.mark{color:#67e8f9;font-weight:800;letter-spacing:-.02em;font-size:22px}
h1{font-size:32px;font-weight:800;letter-spacing:-.04em;line-height:1.1;margin:8px 0 6px}
.lead,.muted{color:#999ca0}
section{border-top:1px solid #1f2227;padding:24px 0}
h2{font-size:18px;margin:0 0 4px}
.label{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.12em;color:#999ca0;display:block;margin:14px 0 8px}
input,textarea{box-sizing:border-box;width:100%;background:#111318;color:#f1f5f9;border:1px solid #2a2d33;border-radius:6px;padding:10px 12px;font:14px ui-monospace,SFMono-Regular,Menlo,monospace}
textarea{min-height:120px}
input:focus,textarea:focus{outline:2px solid #06b6d4;outline-offset:1px}
a{color:#67e8f9}
ol{padding-left:20px;margin:8px 0;color:#c9cdd3}
button{margin-top:24px;background:#06b6d4;color:#0a0a0f;border:0;border-radius:6px;padding:11px 18px;font-weight:700;font-size:15px;cursor:pointer}
.status{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:10px}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px}
.ok .dot{background:#22c55e}.bad .dot{background:#fbbf24}
dl{display:grid;grid-template-columns:auto 1fr;gap:10px 18px;margin:24px 0}
dt{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase;letter-spacing:.12em;color:#999ca0;align-self:center}
dd{margin:0;font:15px ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}
</style></head><body><main>
<div class="mark">crate</div>
{{if .Rows}}
<h1>Sign in to Crate</h1>
<dl>{{range .Rows}}<dt>{{index . 0}}</dt><dd>{{index . 1}}</dd>{{end}}</dl>
<p class="muted">{{.Note}}</p>
{{else}}
<h1>Private settings</h1>
<p class="lead">Your AI assistant asked for these. What you type here goes straight to the installer on this computer; the assistant only learns whether each value works.</p>
{{if .Saved}}<p class="muted">Saved. Fix anything marked below, or tell the assistant you are done.</p>{{end}}
<form method="post" autocomplete="off">
{{$outcomes := .Outcomes}}
{{range .Blocks}}
<section>
<h2>{{.Title}}</h2>
<p class="muted">{{.Summary}}</p>
{{if .URL}}<p>Get it at <a href="{{.URL}}" target="_blank" rel="noopener noreferrer">{{.URL}}</a></p>{{end}}
{{if .Steps}}<ol>{{range .Steps}}<li>{{.}}</li>{{end}}</ol>{{end}}
{{range .Fields}}<label class="label" for="{{.Key}}">{{.Label}}</label>
{{if .Multiline}}<textarea id="{{.Key}}" name="{{.Key}}" spellcheck="false"></textarea>{{else}}<input id="{{.Key}}" name="{{.Key}}" type="password" spellcheck="false">{{end}}
{{end}}
{{with index $outcomes .ID}}<div class="status {{if .OK}}ok{{else}}bad{{end}}"><span class="dot"></span>{{.Message}}</div>{{end}}
</section>
{{end}}
<button type="submit">Save</button>
</form>
{{end}}
</main></body></html>`))
