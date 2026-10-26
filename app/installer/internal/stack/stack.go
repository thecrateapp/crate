// Package stack drives the installed compose project.
package stack

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
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
