// Package agent sets up Crate Agent and Crate Operator on a home
// installation. The setup itself is scripts/agent_setup.py, run inside a
// throwaway crate-api container so the host needs no Python.
package agent

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"github.com/thecrateapp/crate/app/installer/internal/assets"
	"github.com/thecrateapp/crate/app/installer/internal/envfile"
)

type Mode string

const (
	Off      Mode = ""
	Agent    Mode = "agent"
	Operator Mode = "operator"
)

// ParseMode accepts the values CRATE_AGENT_MODE may hold.
func ParseMode(value string) (Mode, bool) {
	switch mode := Mode(strings.ToLower(strings.TrimSpace(value))); mode {
	case Off, Agent, Operator:
		return mode, true
	}
	return Off, false
}

// Profile describes how one mode runs in compose.
type Profile struct {
	Name      string
	Container string
	Compose   string
	Services  []string
}

var profiles = map[Mode]Profile{
	Agent: {Name: "Crate Agent", Container: "crate-agent", Compose: "agent", Services: []string{"crate-agent"}},
	Operator: {Name: "Crate Operator", Container: "crate-operator", Compose: "crate-operator", Services: []string{
		"crate-operator", "crate-infra-relay", "crate-operator-supervisor", "crate-provenance", "crate-provenance-docker",
	}},
}

func (m Mode) Profile() Profile { return profiles[m] }

// Name is the product name of the mode.
func (m Mode) Name() string {
	if m == Off {
		return "Off"
	}
	return profiles[m].Name
}

const (
	// SetupCommand is what home installs run to change the agent.
	SetupCommand = "crate configure agent"
	// SignInCommand signs a running agent in to its model provider.
	SignInCommand = "crate configure agent --sign-in"
)

// OperatorOverlay is the compose file Crate Operator adds, relative to the
// install folder.
var OperatorOverlay = assets.Deployed[assets.OperatorOverlay]

func get(values *envfile.Values, key string) string {
	if values == nil {
		return ""
	}
	value, _ := values.Get(key)
	return strings.TrimSpace(value)
}

func profileList(values *envfile.Values) []string {
	var list []string
	for _, profile := range strings.Split(get(values, "COMPOSE_PROFILES"), ",") {
		if profile = strings.TrimSpace(profile); profile != "" {
			list = append(list, profile)
		}
	}
	return list
}

// Wanted is the mode the settings ask for.
func Wanted(values *envfile.Values) Mode {
	mode, _ := ParseMode(get(values, "CRATE_AGENT_MODE"))
	return mode
}

// Active is the mode whose compose profile runs.
func Active(values *envfile.Values) Mode {
	list := profileList(values)
	switch {
	case slices.Contains(list, profiles[Operator].Compose):
		return Operator
	case slices.Contains(list, profiles[Agent].Compose):
		return Agent
	}
	return Off
}

// Activate points the settings at mode: its compose profile and, for Crate
// Operator, its overlay.
func Activate(values *envfile.Values, mode Mode) {
	list := slices.DeleteFunc(profileList(values), func(p string) bool {
		return p == profiles[Agent].Compose || p == profiles[Operator].Compose
	})
	if mode != Off {
		list = append(list, profiles[mode].Compose)
	}
	values.Set("COMPOSE_PROFILES", strings.Join(list, ","))
	files := slices.DeleteFunc(strings.Split(get(values, "COMPOSE_FILE"), ":"), func(f string) bool {
		return strings.TrimSpace(f) == "" || f == OperatorOverlay
	})
	if mode == Operator {
		if len(files) == 0 {
			files = []string{"docker-compose.yaml"}
		}
		files = append(files, OperatorOverlay)
	}
	if len(files) == 0 || (len(files) == 1 && files[0] == "docker-compose.yaml") {
		values.Delete("COMPOSE_FILE")
		return
	}
	values.Set("COMPOSE_FILE", strings.Join(files, ":"))
}

// Layout is where a mode keeps its state on the host.
type Layout struct {
	Root    string
	Secrets string
}

func dataDir(values *envfile.Values) string {
	return get(values, "DATA_DIR")
}

func operatorRoot(values *envfile.Values) string {
	if root := get(values, "CRATE_OPERATOR_ROOT"); root != "" {
		return root
	}
	return filepath.Join(dataDir(values), "crate-operator")
}

func LayoutOf(values *envfile.Values, mode Mode) Layout {
	if mode == Operator {
		root := operatorRoot(values)
		return Layout{Root: root, Secrets: filepath.Join(root, "secrets", "domain")}
	}
	root := filepath.Join(dataDir(values), "crate-agent")
	return Layout{Root: root, Secrets: filepath.Join(root, "secrets")}
}

var (
	BotPattern   = regexp.MustCompile(`^[0-9]+:[A-Za-z0-9_-]{30,}$`)
	UsersPattern = regexp.MustCompile(`^[1-9][0-9]*(,[1-9][0-9]*)*$`)
)

// Stored tells which secrets a mode already has, without reading them out.
type Stored struct {
	Bot, Users bool
	keys       string
}

// StoredSecrets looks at a mode's secret files. Files the installer cannot
// read count as missing.
func StoredSecrets(values *envfile.Values, mode Mode) Stored {
	secrets := LayoutOf(values, mode).Secrets
	return Stored{
		Bot:   matches(filepath.Join(secrets, "telegram-token"), BotPattern.MatchString),
		Users: matches(filepath.Join(secrets, "allowed-users"), UsersPattern.MatchString),
		keys:  filepath.Join(secrets, "model-keys"),
	}
}

// Key reports whether a model key is stored for provider.
func (s Stored) Key(provider string) bool {
	return s.keys != "" && matches(filepath.Join(s.keys, provider), ValidKey)
}

func matches(path string, valid func(string) bool) bool {
	data, err := os.ReadFile(path)
	return err == nil && valid(strings.TrimSpace(string(data)))
}
