package validate

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

var (
	goodBot     = "123456:" + strings.Repeat("A", 35)
	badBot      = "123456:" + strings.Repeat("B", 35)
	conflictBot = "123456:" + strings.Repeat("C", 35)
)

// fakeProviders answers like each provider does for the key "good" and
// refuses anything else.
func fakeProviders(t *testing.T) Client {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/lastfm/", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		params := map[string]string{"method": q.Get("method"), "api_key": q.Get("api_key")}
		switch {
		case q.Get("api_key") != "good":
			w.Write([]byte(`{"error":10,"message":"Invalid API key"}`))
		case q.Get("api_sig") != lastfmSignature(params, "good"):
			w.Write([]byte(`{"error":13,"message":"Invalid method signature"}`))
		default:
			w.Write([]byte(`{"token":"abc"}`))
		}
	})
	mux.HandleFunc("/fanart/music/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("api_key") != "good" {
			w.WriteHeader(http.StatusUnauthorized)
		}
	})
	mux.HandleFunc("/spotify", func(w http.ResponseWriter, r *http.Request) {
		if id, secret, _ := r.BasicAuth(); id != "good" || secret != "good" {
			w.WriteHeader(http.StatusBadRequest)
		}
	})
	mux.HandleFunc("/discogs/database/search", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("key") != "good" || r.URL.Query().Get("secret") != "good" {
			w.WriteHeader(http.StatusUnauthorized)
		}
	})
	mux.HandleFunc("/setlistfm/search/artists", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "good" {
			w.WriteHeader(http.StatusForbidden)
		}
	})
	mux.HandleFunc("/ticketmaster/events.json", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("apikey") != "good" {
			w.WriteHeader(http.StatusUnauthorized)
		}
	})
	mux.HandleFunc("/slskd/api/v0/application", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-API-Key") != "good" {
			w.WriteHeader(http.StatusUnauthorized)
		}
	})
	mux.HandleFunc("/gemini/models", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("key") != "good" {
			w.WriteHeader(http.StatusBadRequest)
		}
	})
	mux.HandleFunc("/openai/models", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer good" {
			w.WriteHeader(http.StatusUnauthorized)
		}
	})
	mux.HandleFunc("/anthropic/models", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "good" || r.Header.Get("anthropic-version") == "" {
			w.WriteHeader(http.StatusUnauthorized)
		}
	})
	mux.HandleFunc("/ollama/api/tags", func(w http.ResponseWriter, r *http.Request) {})
	mux.HandleFunc("/telegram/bot"+goodBot+"/getMe", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"ok":true,"result":{"username":"crate_bot"}}`))
	})
	mux.HandleFunc("/telegram/bot"+goodBot+"/getUpdates", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"ok":true,"result":[
			{"message":{"chat":{"id":111,"type":"private"},"from":{"id":111,"first_name":"Ana","username":"ana"}}},
			{"message":{"chat":{"id":-500,"type":"group"},"from":{"id":222,"first_name":"Group"}}},
			{"message":{"chat":{"id":333,"type":"private"},"from":{"id":333,"first_name":"Bot","is_bot":true}}},
			{"message":{"chat":{"id":444,"type":"private"},"from":{"id":444,"first_name":"Luis"}}},
			{"message":{"chat":{"id":111,"type":"private"},"from":{"id":111,"first_name":"Ana","username":"ana"}}},
			{"edited_message":{}}
		]}`))
	})
	mux.HandleFunc("/telegram/bot"+conflictBot+"/getUpdates", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusConflict)
		w.Write([]byte(`{"ok":false,"error_code":409}`))
	})
	mux.HandleFunc("/telegram/", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"ok":false}`))
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	base := server.URL
	return Client{
		HTTP: server.Client(),
		Endpoints: Endpoints{
			LastFM: base + "/lastfm/", Fanart: base + "/fanart", SpotifyAuth: base + "/spotify",
			Discogs: base + "/discogs", Setlistfm: base + "/setlistfm", Ticketmaster: base + "/ticketmaster",
			Gemini: base + "/gemini", OpenAI: base + "/openai", Anthropic: base + "/anthropic",
			Telegram: base + "/telegram",
		},
	}
}

func TestProbes(t *testing.T) {
	client := fakeProviders(t)
	slskd := client.Endpoints.LastFM[:len(client.Endpoints.LastFM)-len("/lastfm/")] + "/slskd"
	ollama := client.Endpoints.LastFM[:len(client.Endpoints.LastFM)-len("/lastfm/")] + "/ollama"
	cases := []struct {
		id     string
		values Values
		want   Status
	}{
		{"lastfm", Values{"LASTFM_APIKEY": "good", "LASTFM_API_SECRET": "good"}, Valid},
		{"lastfm", Values{"LASTFM_APIKEY": "bad", "LASTFM_API_SECRET": "good"}, Rejected},
		{"lastfm", Values{"LASTFM_APIKEY": "good", "LASTFM_API_SECRET": "bad"}, Rejected},
		{"lastfm", Values{"LASTFM_APIKEY": "good"}, Incomplete},
		{"fanart", Values{"FANART_API_KEY": "good"}, Valid},
		{"fanart", Values{"FANART_API_KEY": "bad"}, Rejected},
		{"spotify", Values{"SPOTIFY_ID": "good", "SPOTIFY_SECRET": "good"}, Valid},
		{"spotify", Values{"SPOTIFY_ID": "good", "SPOTIFY_SECRET": "bad"}, Rejected},
		{"discogs", Values{"DISCOGS_CONSUMER_KEY": "good", "DISCOGS_CONSUMER_SECRET": "good"}, Valid},
		{"discogs", Values{"DISCOGS_CONSUMER_KEY": "bad", "DISCOGS_CONSUMER_SECRET": "good"}, Rejected},
		{"setlistfm", Values{"SETLISTFM_API_KEY": "good"}, Valid},
		{"setlistfm", Values{"SETLISTFM_API_KEY": "bad"}, Rejected},
		{"ticketmaster", Values{"TICKETMASTER_API_KEY": "good"}, Valid},
		{"ticketmaster", Values{"TICKETMASTER_API_KEY": "bad"}, Rejected},
		{"slskd", Values{"SLSKD_URL": slskd, "SLSKD_API_KEY": "good"}, Valid},
		{"slskd", Values{"SLSKD_URL": slskd, "SLSKD_API_KEY": "bad"}, Rejected},
		{"slskd", Values{"SLSKD_URL": "http://slskd:5030", "SLSKD_API_KEY": "generated"}, Skipped},
		{"ai", Values{"GEMINI_API_KEY": "good", "ANTHROPIC_API_KEY": "good"}, Valid},
		{"ai", Values{"OPENAI_API_KEY": "bad"}, Rejected},
		{"ai", Values{"OLLAMA_URL": ollama}, Valid},
		{"ai", Values{"LLM_PROVIDER": "gemini/gemini-2.5-flash"}, Incomplete},
		{"agent", Values{"CRATE_AGENT_MODE": "agent", "AGENT_TELEGRAM_TOKEN": goodBot}, Valid},
		{"agent", Values{"CRATE_AGENT_MODE": "agent", "AGENT_TELEGRAM_TOKEN": badBot}, Rejected},
		{"agent", Values{"CRATE_AGENT_MODE": "agent", "AGENT_TELEGRAM_TOKEN": "good"}, Rejected},
		{"agent", Values{"CRATE_AGENT_MODE": "agent"}, Valid},
		{"agent", Values{}, Incomplete},
		{"agent", Values{"CRATE_AGENT_MODE": "admin"}, Rejected},
		{"agent", Values{"CRATE_AGENT_MODE": "agent", "AGENT_ALLOWED_USERS": "111, 444"}, Valid},
		{"agent", Values{"CRATE_AGENT_MODE": "agent", "AGENT_ALLOWED_USERS": "@ana"}, Rejected},
		{"agent", Values{"CRATE_AGENT_MODE": "agent", "CRATE_AGENT_PROVIDER": "ollama"}, Rejected},
		{"agent", Values{"CRATE_AGENT_MODE": "agent", "CRATE_AGENT_PROVIDER": "anthropic"}, Rejected},
		{"agent", Values{"CRATE_AGENT_MODE": "agent", "CRATE_AGENT_PROVIDER": "anthropic", "CRATE_AGENT_MODEL": "claude-sonnet-5", "AGENT_MODEL_API_KEY": "good-key-1234"}, Rejected},
		{"agent", Values{"CRATE_AGENT_MODE": "agent", "CRATE_AGENT_PROVIDER": "openai-codex", "AGENT_MODEL_API_KEY": "sk-0123456789"}, Rejected},
		{"agent", Values{"CRATE_AGENT_MODE": "agent", "CRATE_AGENT_PROVIDER": "deepseek", "CRATE_AGENT_MODEL": "deepseek-chat", "AGENT_MODEL_API_KEY": "sk-0123456789"}, Valid},
		{"agent", Values{"CRATE_AGENT_MODE": "agent", "CRATE_AGENT_PROVIDER": "custom", "CRATE_AGENT_MODEL": "qwen3", "CRATE_AGENT_BASE_URL": "http://192.168.1.20:11434/v1"}, Valid},
		{"agent", Values{"CRATE_AGENT_MODE": "operator", "AGENT_ALLOWED_USERS": "111", "AGENT_APPROVER_TELEGRAM_ID": "444"}, Rejected},
		{"agent", Values{"CRATE_AGENT_MODE": "operator", "AGENT_APPROVER_EMAIL": "admin"}, Rejected},
		{"agent", Values{"CRATE_AGENT_MODE": "operator", "AGENT_ALLOWED_USERS": "111,444", "AGENT_APPROVER_TELEGRAM_ID": "444", "AGENT_APPROVER_EMAIL": "admin@cratemusic.app"}, Valid},
		{"tidal", Values{}, Skipped},
	}
	for _, tc := range cases {
		t.Run(tc.id, func(t *testing.T) {
			if got := client.Check(context.Background(), tc.id, tc.values); got.Status != tc.want {
				t.Fatalf("%v: got %v (%s), want %v", tc.values, got.Status, got.Message, tc.want)
			}
		})
	}
}

func TestUnreachableProvidersAreNotRejections(t *testing.T) {
	client := Client{HTTP: http.DefaultClient, Endpoints: Endpoints{Fanart: "http://127.0.0.1:1"}}
	if got := client.Check(context.Background(), "fanart", Values{"FANART_API_KEY": "x"}); got.Status != Unreachable {
		t.Fatalf("got %v", got.Status)
	}
}

func TestAgentModelKeysAreCheckedWithTheirProvider(t *testing.T) {
	client := fakeProviders(t)
	cases := []struct {
		provider, model, baseURL, key string
		want                          Status
	}{
		{"anthropic", "claude-sonnet-5", "", "goodgood", Rejected},
		{"openai-api", "gpt-5", "", "badbadbad", Rejected},
		{"openai-api", "gpt-5", "https://gateway.example.test/v1", "badbadbad", Valid},
		{"gemini", "gemini-pro", "", "badbadbad", Rejected},
	}
	for _, tc := range cases {
		got := client.Check(context.Background(), "agent", Values{
			"CRATE_AGENT_MODE": "agent", "CRATE_AGENT_PROVIDER": tc.provider, "CRATE_AGENT_MODEL": tc.model,
			"CRATE_AGENT_BASE_URL": tc.baseURL, "AGENT_MODEL_API_KEY": tc.key,
		})
		if got.Status != tc.want {
			t.Errorf("%s: got %v (%s)", tc.provider, got.Status, got.Message)
		}
	}
}

func TestTelegramPrivateUsersListsPeopleOnce(t *testing.T) {
	client := fakeProviders(t)
	users, err := client.TelegramPrivateUsers(context.Background(), goodBot)
	if err != nil || len(users) != 2 || users[0].ID != 111 || users[1].ID != 444 {
		t.Fatalf("got %+v, %v", users, err)
	}
	if users[0].Label() != "Ana @ana (111)" || users[1].Label() != "Luis (444)" {
		t.Fatalf("labels %q %q", users[0].Label(), users[1].Label())
	}
	cases := map[string]error{conflictBot: ErrTelegramConflict, badBot: ErrRejected, "not-a-token": ErrRejected}
	for token, want := range cases {
		if _, err := client.TelegramPrivateUsers(context.Background(), token); !errors.Is(err, want) {
			t.Errorf("%s: got %v", token, err)
		}
	}
}

func TestHostReachableRewritesTheDockerHostName(t *testing.T) {
	if got := hostReachable("http://host.docker.internal:11434/"); got != "http://localhost:11434" {
		t.Fatalf("got %q", got)
	}
}
