package agent

import (
	"fmt"
	"regexp"
)

type KeyUse int

const (
	NoKey KeyUse = iota
	OptionalKey
	RequiredKey
)

type URLUse int

const (
	NoURL URLUse = iota
	OptionalURL
	RequiredURL
)

// Provider is a model provider the agent runtime supports, mirrored from
// PROVIDERS in deploy/hermes/runtime.py.
type Provider struct {
	ID      string
	Title   string
	Key     KeyUse
	BaseURL URLUse
	SignIn  string
	KeyURL  string
}

const (
	DefaultProvider = "openai-codex"
	DefaultModel    = "gpt-6-luna"
)

var Providers = []Provider{
	{ID: "openai-codex", Title: "ChatGPT subscription", SignIn: "Sign in to ChatGPT"},
	{ID: "openai-api", Title: "OpenAI API", Key: RequiredKey, BaseURL: OptionalURL, KeyURL: "https://platform.openai.com/api-keys"},
	{ID: "anthropic", Title: "Anthropic", Key: RequiredKey, KeyURL: "https://console.anthropic.com/settings/keys"},
	{ID: "openrouter", Title: "OpenRouter", Key: RequiredKey, KeyURL: "https://openrouter.ai/settings/keys"},
	{ID: "nous", Title: "Nous Portal", Key: OptionalKey, SignIn: "Sign in to Nous Portal", KeyURL: "https://portal.nousresearch.com"},
	{ID: "gemini", Title: "Gemini", Key: RequiredKey, KeyURL: "https://aistudio.google.com/app/apikey"},
	{ID: "deepseek", Title: "DeepSeek", Key: RequiredKey, KeyURL: "https://platform.deepseek.com/api_keys"},
	{ID: "custom", Title: "Another OpenAI-compatible endpoint (Ollama, vLLM, LM Studio)", Key: OptionalKey, BaseURL: RequiredURL},
}

func FindProvider(id string) (Provider, bool) {
	if id == "" {
		id = DefaultProvider
	}
	for _, p := range Providers {
		if p.ID == id {
			return p, true
		}
	}
	return Provider{}, false
}

var (
	modelPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$`)
	urlPattern   = regexp.MustCompile(`^https?://[^\s"'<>]+$`)
	keyPattern   = regexp.MustCompile(`^[\x21-\x7e]+$`)
)

// Model returns the model the runtime uses for model, filling the default.
func (p Provider) Model(model string) string {
	if model == "" && p.ID == DefaultProvider {
		return DefaultModel
	}
	return model
}

// Problem applies the runtime's rules to a model and base URL; "" means fine.
func (p Provider) Problem(model, baseURL string) string {
	model = p.Model(model)
	switch {
	case model == "":
		return "choose a model for " + p.Title
	case !modelPattern.MatchString(model):
		return fmt.Sprintf("%q is not a model id", model)
	case baseURL != "" && p.BaseURL == NoURL:
		return p.Title + " takes no base URL; leave it empty"
	case baseURL == "" && p.BaseURL == RequiredURL:
		return p.Title + " needs the endpoint's base URL, such as http://192.168.1.20:11434/v1"
	case baseURL != "" && (!urlPattern.MatchString(baseURL) || len(baseURL) > 2008):
		return "the base URL must start with http:// or https://"
	}
	return ""
}

// ValidKey reports whether key has the shape the runtime accepts.
func ValidKey(key string) bool {
	return len(key) >= 8 && len(key) <= 4096 && keyPattern.MatchString(key)
}
