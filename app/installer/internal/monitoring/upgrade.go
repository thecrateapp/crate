package monitoring

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/thecrateapp/crate/app/installer/internal/observability"
)

// Snapshot is what a monitoring upgrade compares: the files running
// services read at start and the Grafana image.
type Snapshot struct {
	Files   map[string]string
	Grafana string
}

func (m Monitor) monitoringDir() string {
	return filepath.Join(m.Dir, "deploy", "observability")
}

// Snapshot reads the monitoring files on disk now.
func (m Monitor) Snapshot() Snapshot {
	snapshot := Snapshot{Files: map[string]string{}}
	for name := range observability.MountedFiles {
		if data, err := os.ReadFile(filepath.Join(m.monitoringDir(), filepath.FromSlash(name))); err == nil {
			sum := sha256.Sum256(data)
			snapshot.Files[name] = hex.EncodeToString(sum[:])
		}
	}
	var compose struct {
		Services map[string]struct {
			Image string `yaml:"image"`
		} `yaml:"services"`
	}
	if data, err := os.ReadFile(filepath.Join(m.monitoringDir(), "compose.observability.yaml")); err == nil && yaml.Unmarshal(data, &compose) == nil {
		snapshot.Grafana = compose.Services["crate-grafana"].Image
	}
	return snapshot
}

// Upgrade brings running monitoring to the files `crate install` just wrote.
// Grafana's data is copied before a new Grafana image migrates it, the
// project is started again, and services whose mounted files changed are
// restarted.
func (m Monitor) Upgrade(ctx context.Context, before Snapshot) (Enabled, error) {
	after := m.Snapshot()
	stored := m.stored()
	containerd := value(stored, "OBS_CONTAINERD") == "1"
	newGrafana := before.Grafana != "" && after.Grafana != before.Grafana
	if newGrafana {
		values, err := m.installation()
		if err != nil {
			return Enabled{}, err
		}
		m.step("Stopping Grafana to back up its data before the new version migrates it")
		name, args := m.compose(containerd, "stop", "crate-grafana")
		if err := m.Run.Stream(ctx, m.Out, m.Dir, name, args...); err != nil {
			return Enabled{}, fmt.Errorf("stop Grafana: %w", err)
		}
		if _, err := m.setup(ctx, m.app(values), value(stored, "OBS_DATA_DIR"), nil, "backup-grafana"); err != nil {
			return Enabled{}, fmt.Errorf("back up Grafana: %w", err)
		}
	}
	result, err := m.Enable(ctx)
	if err != nil {
		return Enabled{}, err
	}
	var restart []string
	for name, service := range observability.MountedFiles {
		if before.Files[name] == after.Files[name] || slices.Contains(restart, service) || (service == "crate-grafana" && newGrafana) {
			continue
		}
		restart = append(restart, service)
	}
	if len(restart) == 0 {
		return result, nil
	}
	slices.Sort(restart)
	m.step("Restarting " + strings.Join(restart, ", ") + " to read their new configuration")
	name, args := m.compose(containerd, append([]string{"restart"}, restart...)...)
	if err := m.Run.Stream(ctx, m.Out, m.Dir, name, args...); err != nil {
		return Enabled{}, fmt.Errorf("restart monitoring: %w", err)
	}
	return result, m.waitGrafana(ctx, value(stored, "OBS_GRAFANA_PORT"))
}
