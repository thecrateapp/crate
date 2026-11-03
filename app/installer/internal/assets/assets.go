// Package assets embeds the files an installer version deploys, so every
// release installs exactly the compose stack it was built with.
package assets

import (
	"embed"
	"io/fs"
)

//go:generate go run ../../cmd/sync-assets

//go:embed files/*
var files embed.FS

const (
	Compose          = "docker-compose.home.yaml"
	CrateConfig      = "config.yaml"
	FederationRoutes = "federation-readplane.yml"
	Manifest         = "integrations.yaml"
	AgentSetup       = "agent_setup.py"
	AgentRuntime     = "runtime.py"
	OperatorOverlay  = "compose.operator.yaml"
	OperatorExample  = "config.operator.example.json"
	ProvenanceProxy  = "provenance-docker.haproxy.cfg"
)

// ObservabilityDir holds the monitoring files, embedded under the same
// relative paths they have in deploy/observability.
const ObservabilityDir = "observability"

// ObservabilityFiles are the monitoring release bundle followed by the
// application overlays, relative to deploy/observability.
var ObservabilityFiles = []string{
	"compose.standalone.yaml",
	"compose.observability.yaml",
	"compose.containerd.yaml",
	"prometheus.yml",
	"recording-rules.yml",
	"docker-proxy.haproxy.cfg",
	"runtime-proxy.haproxy.cfg",
	"grafana/provisioning/dashboards/infrastructure.yaml",
	"grafana/provisioning/datasources/prometheus.yaml",
	"grafana/dashboards/infra-runtime.json",
	"grafana/dashboards/infra-data.json",
	"grafana/dashboards/app-overview.json",
	"grafana/dashboards/app-playback.json",
	"grafana/dashboards/app-workers.json",
	"grafana/dashboards/app-telemetry.json",
	"compose.projector-prometheus.yaml",
	"compose.traefik-metrics.yaml",
	"compose.app-metrics.yaml",
	"compose.supervisor-prometheus.yaml",
}

// Sources maps each embedded file to its path from the repository root.
var Sources = withObservability(map[string]string{
	Compose:          "docker-compose.home.yaml",
	CrateConfig:      "app/config.yaml",
	FederationRoutes: "deploy/traefik/federation-readplane.yml",
	Manifest:         "deploy/install/integrations.yaml",
	AgentSetup:       "scripts/agent_setup.py",
	AgentRuntime:     "deploy/hermes/runtime.py",
	OperatorOverlay:  "deploy/operator/compose.operator.yaml",
	OperatorExample:  "deploy/operator/config.operator.example.json",
	ProvenanceProxy:  "deploy/operator/provenance-docker.haproxy.cfg",
})

func withObservability(sources map[string]string) map[string]string {
	for _, name := range ObservabilityFiles {
		sources[ObservabilityDir+"/"+name] = "deploy/observability/" + name
	}
	return sources
}

// Deployed maps the embedded files written into the install folder to
// their path there.
var Deployed = map[string]string{
	Compose:          "docker-compose.yaml",
	CrateConfig:      "config.yaml",
	FederationRoutes: "deploy/traefik/federation-readplane.yml",
	AgentSetup:       "scripts/agent_setup.py",
	AgentRuntime:     "deploy/hermes/runtime.py",
	OperatorOverlay:  "deploy/operator/compose.operator.yaml",
	OperatorExample:  "deploy/operator/config.operator.example.json",
	ProvenanceProxy:  "deploy/operator/provenance-docker.haproxy.cfg",
}

func Read(name string) ([]byte, error) {
	return fs.ReadFile(files, "files/"+name)
}
