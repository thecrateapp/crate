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
)

// Sources maps each embedded file to its path from the repository root.
var Sources = map[string]string{
	Compose:          "docker-compose.home.yaml",
	CrateConfig:      "app/config.yaml",
	FederationRoutes: "deploy/traefik/federation-readplane.yml",
	Manifest:         "deploy/install/integrations.yaml",
	AgentSetup:       "scripts/agent_setup.py",
	AgentRuntime:     "deploy/hermes/runtime.py",
	OperatorOverlay:  "deploy/operator/compose.operator.yaml",
	OperatorExample:  "deploy/operator/config.operator.example.json",
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
}

func Read(name string) ([]byte, error) {
	return fs.ReadFile(files, "files/"+name)
}
