// Package validate checks credentials against their providers before the
// installer writes them.
package validate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

var ErrRejected = errors.New("the provider rejected this credential")

type Client struct {
	HTTP       *http.Client
	Cloudflare string // API base, replaced in tests
	Endpoints  Endpoints
}

func NewClient() Client {
	return Client{
		HTTP:       &http.Client{Timeout: 10 * time.Second},
		Cloudflare: "https://api.cloudflare.com/client/v4",
		Endpoints:  DefaultEndpoints(),
	}
}

// CloudflareToken confirms the token is active. It does not prove the
// token can edit the zone; Let's Encrypt reports that on first issuance.
func (c Client) CloudflareToken(ctx context.Context, token string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.Cloudflare+"/user/tokens/verify", nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := c.HTTP.Do(request)
	if err != nil {
		return fmt.Errorf("could not reach Cloudflare: %w", err)
	}
	defer response.Body.Close()
	var body struct {
		Success bool `json:"success"`
		Result  struct {
			Status string `json:"status"`
		} `json:"result"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		return fmt.Errorf("unexpected answer from Cloudflare (HTTP %d)", response.StatusCode)
	}
	if !body.Success || body.Result.Status != "active" {
		return ErrRejected
	}
	return nil
}
