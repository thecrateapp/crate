package install

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/thecrateapp/crate/app/installer/internal/system"
)

// Command is a privileged step the wizard shows before running it.
type Command struct {
	Description string
	Argv        []string
}

type DNSHost struct {
	OS              string // linux or darwin
	Distro          string
	HostsFile       string // current /etc/hosts content
	HasDNSMasq      bool
	HasResolvectl   bool
	BrewPrefix      string
	ResolvConfLocal bool // /etc/resolv.conf already points at 127.0.0.1
}

func localHostnames(domain string) string {
	return fmt.Sprintf("admin.%[1]s listen.%[1]s api.%[1]s traefik.%[1]s", domain)
}

// LocalNameCommands returns the steps that make *.domain resolve to this
// machine, or nothing for ports and cloudflare modes. Domains are validated
// before they reach a shell.
func LocalNameCommands(cfg Config, host DNSHost) ([]Command, error) {
	if cfg.Access != AccessHosts && cfg.Access != AccessDNSMasq {
		return nil, nil
	}
	if err := ValidateDomain(cfg.Domain); err != nil {
		return nil, err
	}
	if cfg.Access == AccessHosts {
		if strings.Contains(host.HostsFile, "admin."+cfg.Domain) {
			return nil, nil
		}
		line := "127.0.0.1 " + localHostnames(cfg.Domain)
		return []Command{{
			Description: "Add Crate's hostnames to /etc/hosts",
			Argv:        []string{"sudo", "sh", "-c", fmt.Sprintf("printf '\\n# Crate local domains (%s)\\n%s\\n' >> /etc/hosts", cfg.Domain, line)},
		}}, nil
	}
	rule := fmt.Sprintf("address=/.%s/127.0.0.1", cfg.Domain)
	switch host.OS {
	case "darwin":
		return dnsmasqMacOS(cfg.Domain, rule, host)
	case "linux":
		return dnsmasqLinux(cfg.Domain, rule, host)
	}
	return nil, fmt.Errorf("dnsmasq mode supports Linux and macOS only")
}

func dnsmasqMacOS(domain, rule string, host DNSHost) ([]Command, error) {
	if host.BrewPrefix == "" {
		return nil, fmt.Errorf("dnsmasq mode on macOS needs Homebrew; install it from https://brew.sh or use the hosts mode")
	}
	var commands []Command
	if !host.HasDNSMasq {
		commands = append(commands, Command{"Install dnsmasq with Homebrew", []string{"brew", "install", "dnsmasq"}})
	}
	conf := host.BrewPrefix + "/etc/dnsmasq.conf"
	return append(commands,
		Command{"Route *." + domain + " to this machine in dnsmasq", []string{"sh", "-c", fmt.Sprintf("mkdir -p '%s/etc' && grep -qxF '%s' '%s' 2>/dev/null || printf '\\n# Crate local domain\\n%s\\n' >> '%s'", host.BrewPrefix, rule, conf, rule, conf)}},
		Command{"Send ." + domain + " lookups to dnsmasq", []string{"sudo", "sh", "-c", fmt.Sprintf("mkdir -p /etc/resolver && printf 'nameserver 127.0.0.1\\n' > /etc/resolver/%s", domain)}},
		Command{"Restart dnsmasq", []string{"sudo", "brew", "services", "restart", "dnsmasq"}},
		Command{"Flush the DNS cache", []string{"sudo", "killall", "-HUP", "mDNSResponder"}},
	), nil
}

func dnsmasqLinux(domain, rule string, host DNSHost) ([]Command, error) {
	var commands []Command
	if !host.HasDNSMasq {
		install, err := PackageInstall(host.Distro, "dnsmasq")
		if err != nil {
			return nil, err
		}
		commands = append(commands, install...)
	}
	slug := strings.ReplaceAll(domain, ".", "-")
	commands = append(commands,
		Command{"Route *." + domain + " to this machine in dnsmasq", []string{"sudo", "sh", "-c", fmt.Sprintf("mkdir -p /etc/dnsmasq.d && printf '# Crate local domain\\n%s\\n' > /etc/dnsmasq.d/crate-%s.conf", rule, slug)}},
		Command{"Start dnsmasq", []string{"sudo", "systemctl", "enable", "--now", "dnsmasq"}},
		Command{"Reload dnsmasq", []string{"sudo", "systemctl", "restart", "dnsmasq"}},
	)
	if host.HasResolvectl {
		return append(commands,
			Command{"Send ." + domain + " lookups to dnsmasq", []string{"sudo", "sh", "-c", fmt.Sprintf("mkdir -p /etc/systemd/resolved.conf.d && printf '[Resolve]\\nDNS=127.0.0.1\\nDomains=~%s\\n' > /etc/systemd/resolved.conf.d/crate-%s.conf", domain, slug)}},
			Command{"Restart systemd-resolved", []string{"sudo", "systemctl", "restart", "systemd-resolved"}},
		), nil
	}
	if !host.ResolvConfLocal {
		commands = append(commands, Command{"Ask the system resolver to try dnsmasq first", []string{"sudo", "sh", "-c", "cp /etc/resolv.conf /etc/resolv.conf.crate-backup && printf 'nameserver 127.0.0.1\\n' | cat - /etc/resolv.conf.crate-backup > /etc/resolv.conf"}})
	}
	return commands, nil
}

// PackageInstall returns the commands that install pkg with the distro's
// package manager.
func PackageInstall(distro, pkg string) ([]Command, error) {
	switch distro {
	case "ubuntu", "debian", "raspbian":
		return []Command{
			{"Refresh the package index", []string{"sudo", "apt-get", "update"}},
			{"Install " + pkg, []string{"sudo", "apt-get", "install", "-y", pkg}},
		}, nil
	case "fedora":
		return []Command{{"Install " + pkg, []string{"sudo", "dnf", "install", "-y", pkg}}}, nil
	case "arch", "manjaro":
		return []Command{{"Install " + pkg, []string{"sudo", "pacman", "-Sy", "--noconfirm", pkg}}}, nil
	}
	return nil, fmt.Errorf("install %s yourself on %s, or use the hosts mode", pkg, distro)
}

// DetectDNSHost reads what LocalNameCommands needs to know about this machine.
func DetectDNSHost(ctx context.Context, run system.Runner, host system.Host) DNSHost {
	dns := DNSHost{OS: host.OS, Distro: host.Distro}
	if data, err := os.ReadFile("/etc/hosts"); err == nil {
		dns.HostsFile = string(data)
	}
	_, err := exec.LookPath("dnsmasq")
	dns.HasDNSMasq = err == nil
	_, err = exec.LookPath("resolvectl")
	dns.HasResolvectl = err == nil
	if prefix, err := run.Output(ctx, "brew", "--prefix"); err == nil && prefix != "" {
		dns.BrewPrefix = prefix
		if _, err := os.Stat(filepath.Join(prefix, "sbin", "dnsmasq")); err == nil {
			dns.HasDNSMasq = true
		}
	}
	if data, err := os.ReadFile("/etc/resolv.conf"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			if strings.TrimSpace(line) == "nameserver 127.0.0.1" {
				dns.ResolvConfLocal = true
			}
		}
	}
	return dns
}
