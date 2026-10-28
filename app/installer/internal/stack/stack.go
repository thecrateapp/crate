// Package stack drives the installed compose project.
package stack

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/thecrateapp/crate/app/installer/internal/system"
)

type Stack struct {
	Run     system.Runner
	Compose []string // e.g. ["docker", "compose"] or ["sudo", "docker", "compose"]
	Dir     string
	Files   []string // relative to Dir; empty means docker-compose.yaml
}

// InfraBridge is the host socket the optional infrastructure relay of
// Crate Operator needs.
var InfraBridge = "/run/crate-infra/bridge.sock"

// Command is the compose invocation for args in this installation.
func (s Stack) Command(args ...string) (string, []string) {
	full := append(append([]string(nil), s.Compose[1:]...), "--project-directory", s.Dir)
	files := s.Files
	if len(files) == 0 {
		files = []string{"docker-compose.yaml"}
	}
	for _, file := range files {
		full = append(full, "-f", filepath.Join(s.Dir, file))
	}
	full = append(full, "--env-file", filepath.Join(s.Dir, ".env"))
	return s.Compose[0], append(full, args...)
}

func (s Stack) operator() bool {
	for _, file := range s.Files {
		if filepath.Base(file) == "compose.operator.yaml" {
			return true
		}
	}
	return false
}

func (s Stack) Pull(ctx context.Context, w io.Writer) error {
	name, args := s.Command("pull")
	return s.Run.Stream(ctx, w, s.Dir, name, args...)
}

func (s Stack) Up(ctx context.Context, w io.Writer) error {
	up := []string{"up", "-d", "--remove-orphans"}
	if _, err := os.Stat(InfraBridge); s.operator() && err != nil {
		up = append(up, "--scale", "crate-infra-relay=0")
	}
	name, args := s.Command(up...)
	err := s.Run.Stream(ctx, w, s.Dir, name, args...)
	if err == nil {
		return nil
	}
	started := s.startCreated(ctx, w)
	if len(started) == 0 {
		return err
	}
	return fmt.Errorf("%w; started the services compose left created: %s", err, strings.Join(started, ", "))
}

// startCreated starts the containers a failed up recreated but never started,
// so a partial failure does not take the stack down.
func (s Stack) startCreated(ctx context.Context, w io.Writer) []string {
	name, args := s.Command("ps", "--all", "--status", "created", "--format", "{{.Service}}")
	out, err := s.Run.Output(ctx, name, args...)
	if err != nil {
		return nil
	}
	services := strings.Fields(out)
	if len(services) == 0 {
		return nil
	}
	name, args = s.Command(append([]string{"start"}, services...)...)
	if s.Run.Stream(ctx, w, s.Dir, name, args...) != nil {
		return nil
	}
	return services
}

// Restart restarts the services of a compose profile.
func (s Stack) Restart(ctx context.Context, w io.Writer, profile string, services ...string) error {
	name, args := s.Command(append([]string{"--profile", profile, "restart"}, services...)...)
	return s.Run.Stream(ctx, w, s.Dir, name, args...)
}

// Remove stops and deletes the services of a compose profile.
func (s Stack) Remove(ctx context.Context, w io.Writer, profile string, services ...string) error {
	name, args := s.Command(append([]string{"--profile", profile, "rm", "-s", "-f"}, services...)...)
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
	name, args := s.Command("ps", "--all", "--format", "json")
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
