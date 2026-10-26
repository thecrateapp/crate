package install

import (
	"strings"
	"testing"
)

func joined(commands []Command) string {
	var parts []string
	for _, c := range commands {
		parts = append(parts, strings.Join(c.Argv, " "))
	}
	return strings.Join(parts, "\n")
}

func TestLocalNameCommands(t *testing.T) {
	hostsCfg := Defaults("/srv/crate")
	hostsCfg.Access, hostsCfg.Domain = AccessHosts, "crate.local"
	dnsCfg := hostsCfg
	dnsCfg.Access = AccessDNSMasq

	cases := []struct {
		name string
		cfg  Config
		host DNSHost
		want []string
		none bool
	}{
		{name: "ports needs nothing", cfg: Defaults("/srv/crate"), none: true},
		{name: "hosts appends the hostnames", cfg: hostsCfg, host: DNSHost{OS: "linux"}, want: []string{"/etc/hosts", "admin.crate.local listen.crate.local"}},
		{name: "hosts already configured", cfg: hostsCfg, host: DNSHost{OS: "linux", HostsFile: "127.0.0.1 admin.crate.local"}, none: true},
		{name: "debian dnsmasq with resolved", cfg: dnsCfg, host: DNSHost{OS: "linux", Distro: "debian", HasResolvectl: true}, want: []string{"apt-get install -y dnsmasq", "address=/.crate.local/127.0.0.1", "Domains=~crate.local"}},
		{name: "macOS dnsmasq", cfg: dnsCfg, host: DNSHost{OS: "darwin", BrewPrefix: "/opt/homebrew", HasDNSMasq: true}, want: []string{"/etc/resolver/crate.local", "mDNSResponder"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			commands, err := LocalNameCommands(tc.cfg, tc.host)
			if err != nil {
				t.Fatal(err)
			}
			if tc.none {
				if len(commands) != 0 {
					t.Fatalf("expected no commands, got\n%s", joined(commands))
				}
				return
			}
			script := joined(commands)
			for _, fragment := range tc.want {
				if !strings.Contains(script, fragment) {
					t.Errorf("missing %q in\n%s", fragment, script)
				}
			}
		})
	}
}

func TestLocalNameCommandsRefuseUnsupportedHosts(t *testing.T) {
	cfg := Defaults("/srv/crate")
	cfg.Access, cfg.Domain = AccessDNSMasq, "crate.local"
	if _, err := LocalNameCommands(cfg, DNSHost{OS: "darwin"}); err == nil {
		t.Error("macOS without Homebrew must be refused")
	}
	if _, err := LocalNameCommands(cfg, DNSHost{OS: "linux", Distro: "alpine"}); err == nil {
		t.Error("an unknown distro must be refused")
	}
}
