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
)

// Sources maps each embedded file to its path from the repository root.
var Sources = map[string]string{
	Compose:          "docker-compose.home.yaml",
	CrateConfig:      "app/config.yaml",
	FederationRoutes: "deploy/traefik/federation-readplane.yml",
	Manifest:         "deploy/install/integrations.yaml",
}

func Read(name string) ([]byte, error) {
	return fs.ReadFile(files, "files/"+name)
}
