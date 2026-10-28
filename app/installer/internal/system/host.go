package system

import (
	"bufio"
	"context"
	"os"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

type Host struct {
	OS       string // linux or darwin
	Distro   string // os-release ID on Linux, "macos" on darwin
	Arch     string // amd64 or arm64
	MemoryGB float64
	UID      string
	GID      string
	Timezone string
}

func DetectHost(ctx context.Context, run Runner) Host {
	host := Host{OS: runtime.GOOS, Arch: runtime.GOARCH, UID: "1000", GID: "1000"}
	if current, err := user.Current(); err == nil {
		host.UID, host.GID = current.Uid, current.Gid
	}
	switch host.OS {
	case "linux":
		host.Distro = osReleaseID("/etc/os-release")
		host.MemoryGB = linuxMemoryGB("/proc/meminfo")
	case "darwin":
		host.Distro = "macos"
		if out, err := run.Output(ctx, "sysctl", "-n", "hw.memsize"); err == nil {
			if bytes, err := strconv.ParseFloat(out, 64); err == nil {
				host.MemoryGB = bytes / (1 << 30)
			}
		}
	}
	host.Timezone = DetectTimezone(ctx, run)
	return host
}

func osReleaseID(path string) string {
	file, err := os.Open(path)
	if err != nil {
		return "unknown"
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		if value, ok := strings.CutPrefix(scanner.Text(), "ID="); ok {
			return strings.Trim(value, `"`)
		}
	}
	return "unknown"
}

func linuxMemoryGB(path string) float64 {
	file, err := os.Open(path)
	if err != nil {
		return 0
	}
	defer file.Close()
	return parseMemTotal(file)
}

func parseMemTotal(r interface{ Read([]byte) (int, error) }) float64 {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) >= 2 && fields[0] == "MemTotal:" {
			kb, err := strconv.ParseFloat(fields[1], 64)
			if err == nil {
				return kb / (1 << 20)
			}
		}
	}
	return 0
}

// DetectTimezone returns the host's IANA zone, or UTC when it cannot tell.
func DetectTimezone(ctx context.Context, run Runner) string {
	if tz := os.Getenv("TZ"); tz != "" {
		return tz
	}
	if out, err := run.Output(ctx, "timedatectl", "show", "-p", "Timezone", "--value"); err == nil && out != "" {
		return out
	}
	if data, err := os.ReadFile("/etc/timezone"); err == nil {
		if tz := strings.TrimSpace(string(data)); tz != "" {
			return tz
		}
	}
	if target, err := os.Readlink("/etc/localtime"); err == nil {
		if zone := zoneFromLocaltime(target); zone != "" {
			return zone
		}
	}
	return "UTC"
}

func zoneFromLocaltime(target string) string {
	target = filepath.ToSlash(target)
	if _, zone, ok := strings.Cut(target, "zoneinfo/"); ok {
		return zone
	}
	return ""
}
