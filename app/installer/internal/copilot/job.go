package copilot

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/thecrateapp/crate/app/installer/internal/stack"
)

const (
	PhasePulling  = "downloading images"
	PhaseStarting = "starting containers"
	PhaseWaiting  = "waiting for the API"
	PhaseReady    = "ready"
	PhaseFailed   = "failed"
)

const logLines = 40

// job runs pull, up and the health wait in the background, because the
// first download takes longer than agents wait for a tool call.
type job struct {
	mu       sync.Mutex
	phase    string
	err      string
	lines    []string
	partial  string
	started  time.Time
	finished time.Time
}

func (j *job) Write(p []byte) (int, error) {
	j.mu.Lock()
	defer j.mu.Unlock()
	text := strings.ReplaceAll(j.partial+string(p), "\r", "\n")
	parts := strings.Split(text, "\n")
	j.partial = parts[len(parts)-1]
	for _, line := range parts[:len(parts)-1] {
		if line = strings.TrimSpace(line); line != "" {
			j.lines = append(j.lines, line)
		}
	}
	if len(j.lines) > logLines {
		j.lines = j.lines[len(j.lines)-logLines:]
	}
	return len(p), nil
}

func (j *job) set(phase, err string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.phase, j.err = phase, err
	if phase == PhaseReady || phase == PhaseFailed {
		j.finished = time.Now()
	}
}

type jobState struct {
	Phase    string   `json:"phase"`
	Error    string   `json:"error,omitempty"`
	Elapsed  string   `json:"elapsed"`
	LastLogs []string `json:"last_logs,omitempty"`
}

func (j *job) state() jobState {
	j.mu.Lock()
	defer j.mu.Unlock()
	end := j.finished
	if end.IsZero() {
		end = time.Now()
	}
	return jobState{Phase: j.phase, Error: j.err, Elapsed: end.Sub(j.started).Round(time.Second).String(), LastLogs: append([]string(nil), j.lines...)}
}

func (j *job) running() bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.phase != PhaseReady && j.phase != PhaseFailed
}

func startJob(s stack.Stack, client *http.Client, apiURL string, timeout time.Duration) *job {
	j := &job{phase: PhasePulling, started: time.Now()}
	go func() {
		ctx := context.Background()
		if err := s.Pull(ctx, j); err != nil {
			j.set(PhaseFailed, "download failed: "+err.Error())
			return
		}
		j.set(PhaseStarting, "")
		if err := s.Up(ctx, j); err != nil {
			j.set(PhaseFailed, "start failed: "+err.Error())
			return
		}
		j.set(PhaseWaiting, "")
		if err := stack.WaitForAPI(ctx, client, apiURL, timeout, 2*time.Second); err != nil {
			j.set(PhaseFailed, err.Error()+"; run crate_doctor or look at `docker compose logs crate-api`")
			return
		}
		j.set(PhaseReady, "")
	}()
	return j
}
