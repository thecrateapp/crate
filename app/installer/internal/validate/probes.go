package validate

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
)

type Status int

const (
	Valid       Status = iota
	Rejected           // the provider answered and refused the credential
	Unreachable        // no answer; the credential may still be right
	Incomplete         // a required value is missing
	Skipped            // nothing this installer can check
)

type Result struct {
	Status  Status
	Message string
}

func valid(message string) Result      { return Result{Valid, message} }
func rejected(message string) Result   { return Result{Rejected, message} }
func incomplete(message string) Result { return Result{Incomplete, message} }

func unreachable(provider string, err error) Result {
	return Result{Unreachable, fmt.Sprintf("could not reach %s (%v)", provider, err)}
}

// Values are the integration's variables as they would be written to .env.
type Values map[string]string

// Endpoints of every provider; tests point them at local servers.
type Endpoints struct {
	LastFM, Fanart, SpotifyAuth, Discogs, Setlistfm, Ticketmaster string
	Gemini, OpenAI, Anthropic, Telegram                           string
}

func DefaultEndpoints() Endpoints {
	return Endpoints{
		LastFM:       "https://ws.audioscrobbler.com/2.0/",
		Fanart:       "https://webservice.fanart.tv/v3",
		SpotifyAuth:  "https://accounts.spotify.com/api/token",
		Discogs:      "https://api.discogs.com",
		Setlistfm:    "https://api.setlist.fm/rest/1.0",
		Ticketmaster: "https://app.ticketmaster.com/discovery/v2",
		Gemini:       "https://generativelanguage.googleapis.com/v1beta",
		OpenAI:       "https://api.openai.com/v1",
		Anthropic:    "https://api.anthropic.com/v1",
		Telegram:     "https://api.telegram.org",
	}
}

// A well-known MusicBrainz artist id (Radiohead) for lookups that need one.
const probeArtistMBID = "a74b1b7f-71a5-4011-9441-d0b5e4122711"

// Check validates one integration by id. Integrations without a probe, or
// without values, are skipped.
func (c Client) Check(ctx context.Context, id string, values Values) Result {
	probe, ok := map[string]func(context.Context, Values) Result{
		"lastfm":       c.lastfm,
		"fanart":       c.fanart,
		"spotify":      c.spotify,
		"discogs":      c.discogs,
		"setlistfm":    c.setlistfm,
		"ticketmaster": c.ticketmaster,
		"slskd":        c.slskd,
		"ai":           c.ai,
		"telegram":     c.telegram,
	}[id]
	if !ok {
		return Result{Skipped, "nothing to check before Crate starts"}
	}
	return probe(ctx, values)
}

func (c Client) get(ctx context.Context, rawURL string, headers map[string]string) (int, []byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return 0, nil, err
	}
	request.Header.Set("User-Agent", "CrateInstaller/1.0 (+https://cratemusic.app)")
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := c.HTTP.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	return response.StatusCode, body, err
}

func (c Client) lastfm(ctx context.Context, v Values) Result {
	key, secret := v["LASTFM_APIKEY"], v["LASTFM_API_SECRET"]
	if key == "" || secret == "" {
		return incomplete("both the API key and the shared secret are needed")
	}
	// auth.getToken is signed with the secret, so it checks both values.
	params := map[string]string{"method": "auth.getToken", "api_key": key}
	query := url.Values{}
	for name, value := range params {
		query.Set(name, value)
	}
	query.Set("api_sig", lastfmSignature(params, secret))
	query.Set("format", "json")
	_, body, err := c.get(ctx, c.Endpoints.LastFM+"?"+query.Encode(), nil)
	if err != nil {
		return unreachable("Last.fm", err)
	}
	var answer struct {
		Token string `json:"token"`
		Error int    `json:"error"`
	}
	json.Unmarshal(body, &answer)
	switch {
	case answer.Token != "":
		return valid("Last.fm accepted the key and the secret")
	case answer.Error == 10 || answer.Error == 26:
		return rejected("Last.fm does not recognise this API key")
	case answer.Error == 13:
		return rejected("the shared secret does not belong to this API key")
	}
	return Result{Unreachable, fmt.Sprintf("Last.fm answered with error %d; try again later", answer.Error)}
}

func lastfmSignature(params map[string]string, secret string) string {
	names := make([]string, 0, len(params))
	for name := range params {
		names = append(names, name)
	}
	sort.Strings(names)
	var b strings.Builder
	for _, name := range names {
		b.WriteString(name + params[name])
	}
	b.WriteString(secret)
	sum := md5.Sum([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}

func (c Client) fanart(ctx context.Context, v Values) Result {
	key := v["FANART_API_KEY"]
	if key == "" {
		return incomplete("the API key is needed")
	}
	status, _, err := c.get(ctx, c.Endpoints.Fanart+"/music/"+probeArtistMBID+"?api_key="+url.QueryEscape(key), nil)
	return byStatus("fanart.tv", status, err, "fanart.tv does not recognise this API key")
}

func (c Client) spotify(ctx context.Context, v Values) Result {
	id, secret := v["SPOTIFY_ID"], v["SPOTIFY_SECRET"]
	if id == "" || secret == "" {
		return incomplete("both the client ID and the client secret are needed")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoints.SpotifyAuth, strings.NewReader("grant_type=client_credentials"))
	if err != nil {
		return unreachable("Spotify", err)
	}
	request.SetBasicAuth(id, secret)
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := c.HTTP.Do(request)
	if err != nil {
		return unreachable("Spotify", err)
	}
	response.Body.Close()
	return byStatus("Spotify", response.StatusCode, nil, "Spotify rejected this client ID and secret")
}

func (c Client) discogs(ctx context.Context, v Values) Result {
	key, secret := v["DISCOGS_CONSUMER_KEY"], v["DISCOGS_CONSUMER_SECRET"]
	if key == "" || secret == "" {
		return incomplete("both the consumer key and the consumer secret are needed")
	}
	query := url.Values{"q": {"Radiohead"}, "type": {"artist"}, "per_page": {"1"}, "key": {key}, "secret": {secret}}
	status, _, err := c.get(ctx, c.Endpoints.Discogs+"/database/search?"+query.Encode(), nil)
	return byStatus("Discogs", status, err, "Discogs rejected this consumer key and secret")
}

func (c Client) setlistfm(ctx context.Context, v Values) Result {
	key := v["SETLISTFM_API_KEY"]
	if key == "" {
		return incomplete("the API key is needed")
	}
	status, _, err := c.get(ctx, c.Endpoints.Setlistfm+"/search/artists?artistMbid="+probeArtistMBID, map[string]string{"x-api-key": key, "Accept": "application/json"})
	return byStatus("setlist.fm", status, err, "setlist.fm does not recognise this API key")
}

func (c Client) ticketmaster(ctx context.Context, v Values) Result {
	key := v["TICKETMASTER_API_KEY"]
	if key == "" {
		return incomplete("the consumer key is needed")
	}
	status, _, err := c.get(ctx, c.Endpoints.Ticketmaster+"/events.json?size=1&apikey="+url.QueryEscape(key), nil)
	return byStatus("Ticketmaster", status, err, "Ticketmaster does not recognise this consumer key")
}

func (c Client) slskd(ctx context.Context, v Values) Result {
	base, key := strings.TrimRight(v["SLSKD_URL"], "/"), v["SLSKD_API_KEY"]
	if base == "" || key == "" {
		return incomplete("both the slskd URL and its API key are needed")
	}
	if strings.HasPrefix(base, "http://slskd:") {
		return Result{Skipped, "Crate's own slskd starts with the stack"}
	}
	status, _, err := c.get(ctx, base+"/api/v0/application", map[string]string{"X-API-Key": key})
	return byStatus("slskd", status, err, "slskd rejected this API key")
}

func (c Client) telegram(ctx context.Context, v Values) Result {
	token := v["TELEGRAM_BOT_TOKEN"]
	if token == "" {
		return incomplete("the bot token is needed")
	}
	_, result := c.TelegramBot(ctx, token)
	return result
}

// TelegramBot checks the token and returns the bot's username.
func (c Client) TelegramBot(ctx context.Context, token string) (string, Result) {
	status, body, err := c.get(ctx, c.Endpoints.Telegram+"/bot"+token+"/getMe", nil)
	if err != nil {
		return "", unreachable("Telegram", err)
	}
	var answer struct {
		OK     bool `json:"ok"`
		Result struct {
			Username string `json:"username"`
		} `json:"result"`
	}
	json.Unmarshal(body, &answer)
	if status != http.StatusOK || !answer.OK {
		return "", rejected("Telegram does not recognise this bot token")
	}
	return answer.Result.Username, valid("connected to @" + answer.Result.Username)
}

// TelegramLatestChat returns the id of the most recent chat that wrote to
// the bot, or "" when nobody has yet.
func (c Client) TelegramLatestChat(ctx context.Context, token string) (string, error) {
	_, body, err := c.get(ctx, c.Endpoints.Telegram+"/bot"+token+"/getUpdates", nil)
	if err != nil {
		return "", err
	}
	var answer struct {
		Result []struct {
			Message struct {
				Chat struct {
					ID int64 `json:"id"`
				} `json:"chat"`
			} `json:"message"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &answer); err != nil {
		return "", err
	}
	for i := len(answer.Result) - 1; i >= 0; i-- {
		if id := answer.Result[i].Message.Chat.ID; id != 0 {
			return fmt.Sprint(id), nil
		}
	}
	return "", nil
}

func (c Client) ai(ctx context.Context, v Values) Result {
	checks := []struct {
		env, provider string
		probe         func(context.Context, string) (int, error)
	}{
		{"GEMINI_API_KEY", "Gemini", func(ctx context.Context, key string) (int, error) {
			status, _, err := c.get(ctx, c.Endpoints.Gemini+"/models?pageSize=1&key="+url.QueryEscape(key), nil)
			return status, err
		}},
		{"OPENAI_API_KEY", "OpenAI", func(ctx context.Context, key string) (int, error) {
			status, _, err := c.get(ctx, c.Endpoints.OpenAI+"/models", map[string]string{"Authorization": "Bearer " + key})
			return status, err
		}},
		{"ANTHROPIC_API_KEY", "Anthropic", func(ctx context.Context, key string) (int, error) {
			status, _, err := c.get(ctx, c.Endpoints.Anthropic+"/models?limit=1", map[string]string{"x-api-key": key, "anthropic-version": "2023-06-01"})
			return status, err
		}},
	}
	checked := 0
	for _, check := range checks {
		key := v[check.env]
		if key == "" {
			continue
		}
		checked++
		status, err := check.probe(ctx, key)
		if result := byStatus(check.provider, status, err, check.provider+" rejected this API key"); result.Status != Valid {
			return result
		}
	}
	if ollama := v["OLLAMA_URL"]; ollama != "" {
		checked++
		status, _, err := c.get(ctx, hostReachable(ollama)+"/api/tags", nil)
		if result := byStatus("Ollama", status, err, "Ollama answered with an error"); result.Status != Valid {
			return result
		}
	}
	if checked == 0 {
		return incomplete("add a key for at least one provider, or an Ollama URL")
	}
	return valid("every provider answered")
}

// hostReachable rewrites the container-side host.docker.internal name so
// the installer, running on the host, can reach the same service.
func hostReachable(rawURL string) string {
	return strings.TrimRight(strings.Replace(rawURL, "host.docker.internal", "localhost", 1), "/")
}

func byStatus(provider string, status int, err error, rejection string) Result {
	switch {
	case err != nil:
		return unreachable(provider, err)
	case status >= 200 && status < 300, status == http.StatusNotFound:
		return valid(provider + " accepted the credentials")
	case status == http.StatusUnauthorized, status == http.StatusForbidden, status == http.StatusBadRequest:
		return rejected(rejection)
	}
	return Result{Unreachable, fmt.Sprintf("%s answered HTTP %d; try again later", provider, status)}
}
