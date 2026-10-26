// Package stack drives the installed compose project.
package stack

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/thecrateapp/crate/app/installer/internal/system"
)

type Stack struct {
	Run     system.Runner
	Compose []string // e.g. ["docker", "compose"] or ["sudo", "docker", "compose"]
	Dir     string
}

func (s Stack) command(args ...string) (string, []string) {
	full := append(append([]string(nil), s.Compose[1:]...),
		"--project-directory", s.Dir,
		"-f", filepath.Join(s.Dir, "docker-compose.yaml"),
		"--env-file", filepath.Join(s.Dir, ".env"),
	)
	return s.Compose[0], append(full, args...)
}

func (s Stack) Pull(ctx context.Context, w io.Writer) error {
	name, args := s.command("pull")
	return s.Run.Stream(ctx, w, s.Dir, name, args...)
}

func (s Stack) Up(ctx context.Context, w io.Writer) error {
	name, args := s.command("up", "-d", "--remove-orphans")
	return s.Run.Stream(ctx, w, s.Dir, name, args...)
}

// WaitForAPI polls /api/status until Crate answers or timeout passes.
// Startup includes database migrations, so the first run can take minutes.
func WaitForAPI(ctx context.Context, client *http.Client, apiURL string, timeout, interval time.Duration) error {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	url := apiURL + "/api/status"
	for {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return err
		}
		if response, err := client.Do(request); err == nil {
			response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("Crate did not answer at %s within %s", url, timeout)
		case <-time.After(interval):
		}
	}
}

type Service struct {
	Name    string `json:"Name"`
	Service string `json:"Service"`
	State   string `json:"State"`
	Health  string `json:"Health"`
	Status  string `json:"Status"`
}

// Services lists the project's containers, running or not.
func (s Stack) Services(ctx context.Context) ([]Service, error) {
	name, args := s.command("ps", "--all", "--format", "json")
	out, err := s.Run.Output(ctx, name, args...)
	if err != nil {
		return nil, err
	}
	return ParseServices(out)
}

// ParseServices accepts both a JSON array and one JSON object per line;
// Docker Compose has printed each over the years.
func ParseServices(out string) ([]Service, error) {
	out = strings.TrimSpace(out)
	if out == "" {
		return nil, nil
	}
	var services []Service
	if strings.HasPrefix(out, "[") {
		err := json.Unmarshal([]byte(out), &services)
		return services, err
	}
	for _, line := range strings.Split(out, "\n") {
		if line = strings.TrimSpace(line); line == "" {
			continue
		}
		var service Service
		if err := json.Unmarshal([]byte(line), &service); err != nil {
			return nil, err
		}
		services = append(services, service)
	}
	return services, nil
}
