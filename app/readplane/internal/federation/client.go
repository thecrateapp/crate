package federation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxControlPlaneResponseBytes = 64 * 1024

// AuthorizationRequest binds a local relay ticket to one readplane request.
type AuthorizationRequest struct {
	TicketUID   string `json:"ticket_uid"`
	LocalUserID int64  `json:"local_user_id"`
	Method      string `json:"method"`
	RequestPath string `json:"request_path"`
	Audience    string `json:"audience"`
	Range       string `json:"range,omitempty"`
	IfRange     string `json:"if_range,omitempty"`
	Accept      string `json:"accept,omitempty"`
}

// Authorization is ephemeral, path-bound material issued by the FastAPI control plane.
type Authorization struct {
	AuthorizationUID string            `json:"authorization_uid"`
	TicketUID        string            `json:"ticket_uid"`
	RemoteNodeUID    string            `json:"remote_node_uid"`
	Audience         string            `json:"audience"`
	Method           string            `json:"method"`
	RequestPath      string            `json:"request_path"`
	ExternalURL      string            `json:"external_url"`
	ConnectionURL    string            `json:"connection_url"`
	HostHeader       string            `json:"host_header"`
	SNIHostname      string            `json:"sni_hostname"`
	SignedHeaders    map[string]string `json:"signed_headers"`
	ExpiresAt        time.Time         `json:"expires_at"`
}

// Signer exchanges an opaque local ticket for one ephemeral peer authorization.
type Signer interface {
	Authorize(context.Context, AuthorizationRequest) (Authorization, error)
}

// AuthorizationError is a terminal control-plane denial that must not fall back.
type AuthorizationError struct {
	StatusCode int
	Err        error
}

func (e *AuthorizationError) Error() string {
	if e.Err == nil {
		return fmt.Sprintf("stream authorization denied with status %d", e.StatusCode)
	}
	return e.Err.Error()
}

func (e *AuthorizationError) Unwrap() error { return e.Err }

// ControlPlaneSigner obtains short-lived signing material without loading private keys.
type ControlPlaneSigner struct {
	endpoint     *url.URL
	serviceToken string
	client       *http.Client
}

// NewControlPlaneSigner validates and creates a FastAPI control-plane client.
func NewControlPlaneSigner(baseURL, serviceToken string, timeout time.Duration) (*ControlPlaneSigner, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil, errors.New("control plane base URL is required")
	}
	if strings.TrimSpace(serviceToken) == "" {
		return nil, errors.New("readplane service token is required")
	}
	parsed, err := url.Parse(baseURL + "/internal/federation/streams/authorize")
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil {
		return nil, errors.New("control plane base URL is invalid")
	}
	if timeout <= 0 {
		timeout = 2 * time.Second
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	return &ControlPlaneSigner{
		endpoint:     parsed,
		serviceToken: serviceToken,
		client: &http.Client{
			Timeout:   timeout,
			Transport: transport,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

// Authorize requests one bounded authorization from FastAPI.
func (s *ControlPlaneSigner) Authorize(ctx context.Context, payload AuthorizationRequest) (Authorization, error) {
	var authorization Authorization
	body, err := json.Marshal(payload)
	if err != nil {
		return authorization, fmt.Errorf("encode authorization request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, s.endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return authorization, fmt.Errorf("create authorization request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Crate-Service-Token", s.serviceToken)
	response, err := s.client.Do(request)
	if err != nil {
		return authorization, fmt.Errorf("request stream authorization: %w", err)
	}
	defer response.Body.Close()
	limited := io.LimitReader(response.Body, maxControlPlaneResponseBytes+1)
	responseBody, err := io.ReadAll(limited)
	if err != nil {
		return authorization, fmt.Errorf("read stream authorization: %w", err)
	}
	if len(responseBody) > maxControlPlaneResponseBytes {
		return authorization, errors.New("control plane response exceeded byte limit")
	}
	if response.StatusCode >= http.StatusBadRequest && response.StatusCode < http.StatusInternalServerError {
		return authorization, &AuthorizationError{
			StatusCode: response.StatusCode,
			Err:        fmt.Errorf("stream authorization denied with status %d", response.StatusCode),
		}
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return authorization, fmt.Errorf("control plane failed with status %d", response.StatusCode)
	}
	if err := json.Unmarshal(responseBody, &authorization); err != nil {
		return authorization, fmt.Errorf("decode stream authorization: %w", err)
	}
	return authorization, nil
}
