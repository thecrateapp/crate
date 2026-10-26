package agent

import (
	"regexp"
	"strings"
	"testing"

	"github.com/thecrateapp/crate/app/installer/internal/assets"
)

func TestProvidersMirrorTheRuntime(t *testing.T) {
	source, err := assets.Read(assets.AgentRuntime)
	if err != nil {
		t.Fatal(err)
	}
	runtime := string(source)
	block := regexp.MustCompile(`(?s)PROVIDERS = \{(.*?)\n\}`).FindStringSubmatch(runtime)
	if block == nil {
		t.Fatal("PROVIDERS not found in runtime.py")
	}
	entries := regexp.MustCompile(`"([a-z-]+)": Provider\(([^)]*)\)`).FindAllStringSubmatch(block[1], -1)
	if len(entries) != len(Providers) {
		t.Fatalf("runtime.py has %d providers, the installer %d", len(entries), len(Providers))
	}
	for _, entry := range entries {
		id, spec := entry[1], entry[2]
		p, ok := FindProvider(id)
		if !ok {
			t.Errorf("runtime.py provider %s is missing", id)
			continue
		}
		hasKey, oauth := strings.Contains(spec, "key_env="), strings.Contains(spec, "oauth=True")
		wantKey := NoKey
		switch {
		case hasKey && !oauth:
			wantKey = RequiredKey
		case hasKey, strings.Contains(spec, "base_url_required=True"):
			wantKey = OptionalKey
		}
		wantURL := NoURL
		switch {
		case strings.Contains(spec, "base_url_required=True"):
			wantURL = RequiredURL
		case strings.Contains(spec, "base_url_env="):
			wantURL = OptionalURL
		}
		if p.Key != wantKey || p.BaseURL != wantURL || (p.SignIn != "") != oauth {
			t.Errorf("%s: key %v url %v sign-in %q, runtime says %s", id, p.Key, p.BaseURL, p.SignIn, spec)
		}
		if strings.Contains(strings.ToLower(p.Title+p.SignIn), "hermes") {
			t.Errorf("%s: product text names the engine", id)
		}
	}
	for name, want := range map[string]string{"DEFAULT_PROVIDER": DefaultProvider, "DEFAULT_MODEL": DefaultModel} {
		if !strings.Contains(runtime, name+` = "`+want+`"`) {
			t.Errorf("%s in runtime.py is not %q", name, want)
		}
	}
}

func TestProviderRulesMatchTheRuntime(t *testing.T) {
	cases := []struct {
		provider, model, baseURL string
		ok                       bool
	}{
		{"openai-codex", "", "", true},
		{"anthropic", "", "", false},
		{"anthropic", "claude sonnet", "", false},
		{"anthropic", "claude-sonnet-5", "", true},
		{"anthropic", "claude-sonnet-5", "https://example.test", false},
		{"openai-api", "gpt-5", "https://gateway.example.test/v1", true},
		{"custom", "qwen3:32b", "", false},
		{"custom", "qwen3:32b", "ftp://192.168.1.20", false},
		{"custom", "qwen3:32b", "http://192.168.1.20:11434/v1", true},
	}
	for _, tc := range cases {
		p, _ := FindProvider(tc.provider)
		if problem := p.Problem(tc.model, tc.baseURL); (problem == "") != tc.ok {
			t.Errorf("%s %q %q: %q", tc.provider, tc.model, tc.baseURL, problem)
		}
	}
	if !ValidKey("sk-ant-0123456789") || ValidKey("short") || ValidKey("has a space in it") {
		t.Error("key shape")
	}
	if p, ok := FindProvider(""); !ok || p.ID != DefaultProvider {
		t.Error("an empty provider is the default one")
	}
}
