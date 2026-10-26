package system

import (
	"context"
	"os/exec"
)

// Docker holds the commands that reach the daemon on this host: plain
// `docker`, or `sudo docker` when the user is not in the docker group.
type Docker struct {
	Docker  []string
	Compose []string
	Version string
}

type DockerState int

const (
	DockerReady DockerState = iota
	DockerMissing
	DockerUnreachable
	ComposeMissing
)

func DetectDocker(ctx context.Context, run Runner, host Host) (Docker, DockerState) {
	if _, err := exec.LookPath("docker"); err != nil {
		return Docker{}, DockerMissing
	}
	docker := []string{"docker"}
	if _, err := run.Output(ctx, "docker", "info", "--format", "{{.ServerVersion}}"); err != nil {
		if host.OS != "linux" {
			return Docker{}, DockerUnreachable
		}
		if _, err := run.Output(ctx, "sudo", "-n", "docker", "info", "--format", "{{.ServerVersion}}"); err != nil {
			return Docker{}, DockerUnreachable
		}
		docker = []string{"sudo", "docker"}
	}
	version, _ := run.Output(ctx, docker[0], append(docker[1:], "version", "--format", "{{.Server.Version}}")...)
	compose := append(append([]string(nil), docker...), "compose")
	if _, err := run.Output(ctx, compose[0], append(compose[1:], "version", "--short")...); err != nil {
		if _, err := exec.LookPath("docker-compose"); err != nil {
			return Docker{Docker: docker, Version: version}, ComposeMissing
		}
		compose = []string{"docker-compose"}
	}
	return Docker{Docker: docker, Compose: compose, Version: version}, DockerReady
}

// SocketGroup returns the group id that owns the Docker socket.
func SocketGroup(ctx context.Context, run Runner, host Host) string {
	args := []string{"-c", "%g", "/var/run/docker.sock"}
	if host.OS == "darwin" {
		args = []string{"-f", "%g", "/var/run/docker.sock"}
	}
	if out, err := run.Output(ctx, "stat", args...); err == nil && out != "" {
		return out
	}
	return "988"
}
