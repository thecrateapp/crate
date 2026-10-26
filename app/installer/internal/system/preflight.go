package system

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"golang.org/x/sys/unix"
)

type Status int

const (
	OK Status = iota
	Warn
	Fail
)

type Check struct {
	Title  string
	Status Status
	Detail string
	Fix    string
}

const (
	recommendedMemoryGB = 8
	minimumMemoryGB     = 4
	recommendedDiskGB   = 20
)

func ArchitectureCheck(host Host) Check {
	switch host.Arch {
	case "amd64", "arm64":
		return Check{Title: "Architecture", Status: OK, Detail: host.Arch}
	}
	return Check{Title: "Architecture", Status: Fail, Detail: host.Arch + " is not supported", Fix: "Crate publishes images for amd64 and arm64."}
}

func MemoryCheck(host Host) Check {
	detail := fmt.Sprintf("%.0f GB", host.MemoryGB)
	switch {
	case host.MemoryGB == 0:
		return Check{Title: "Memory", Status: Warn, Detail: "could not be measured"}
	case host.MemoryGB < minimumMemoryGB:
		return Check{Title: "Memory", Status: Warn, Detail: detail, Fix: "Crate needs about 8 GB to analyse a library comfortably; expect slow analysis and playback preparation."}
	case host.MemoryGB < recommendedMemoryGB:
		return Check{Title: "Memory", Status: Warn, Detail: detail, Fix: "8 GB or more is recommended; the analysis worker will be slower."}
	default:
		return Check{Title: "Memory", Status: OK, Detail: detail}
	}
}

// DiskCheck measures the free space of the closest existing parent of dir.
func DiskCheck(dir string) Check {
	path := existingParent(dir)
	var stat unix.Statfs_t
	if err := unix.Statfs(path, &stat); err != nil {
		return Check{Title: "Disk space", Status: Warn, Detail: "could not be measured"}
	}
	freeGB := float64(stat.Bavail) * float64(stat.Bsize) / (1 << 30)
	detail := fmt.Sprintf("%.0f GB free in %s", freeGB, path)
	if freeGB < recommendedDiskGB {
		return Check{Title: "Disk space", Status: Warn, Detail: detail, Fix: "Keep at least 20 GB free for images, the database and the stream cache."}
	}
	return Check{Title: "Disk space", Status: OK, Detail: detail}
}

func existingParent(dir string) string {
	path, err := filepath.Abs(dir)
	if err != nil {
		return "/"
	}
	for {
		if _, err := os.Stat(path); err == nil {
			return path
		}
		parent := filepath.Dir(path)
		if parent == path {
			return path
		}
		path = parent
	}
}

// PortsCheck reports which of the given ports another process already uses.
func PortsCheck(ports map[string]int) Check {
	names := make([]string, 0, len(ports))
	for name := range ports {
		names = append(names, name)
	}
	sort.Slice(names, func(i, j int) bool { return ports[names[i]] < ports[names[j]] })
	var busy []string
	for _, name := range names {
		listener, err := net.Listen("tcp", fmt.Sprintf(":%d", ports[name]))
		if err != nil {
			busy = append(busy, fmt.Sprintf("%s %d", name, ports[name]))
			continue
		}
		listener.Close()
	}
	if len(busy) == 0 {
		return Check{Title: "Ports", Status: OK, Detail: "all free"}
	}
	return Check{
		Title:  "Ports",
		Status: Warn,
		Detail: "in use: " + strings.Join(busy, ", "),
		Fix:    "Stop the service that uses them, or pick other ports in the access step.",
	}
}

func DockerCheck(state DockerState, docker Docker, host Host) Check {
	switch state {
	case DockerReady:
		return Check{Title: "Docker", Status: OK, Detail: "Docker " + docker.Version}
	case DockerMissing:
		fix := "Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and run the installer again."
		if host.OS == "linux" {
			fix = "The installer can set it up with Docker's official script (https://get.docker.com)."
		}
		return Check{Title: "Docker", Status: Fail, Detail: "not installed", Fix: fix}
	case DockerUnreachable:
		fix := "Start Docker Desktop and wait until it says it is running."
		if host.OS == "linux" {
			fix = "Start the daemon (sudo systemctl enable --now docker) or add your user to the docker group."
		}
		return Check{Title: "Docker", Status: Fail, Detail: "installed but not reachable", Fix: fix}
	default:
		return Check{Title: "Docker", Status: Fail, Detail: "Docker Compose v2 is missing", Fix: "Update Docker Desktop, or install the docker-compose-plugin package."}
	}
}
