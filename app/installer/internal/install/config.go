// Package install turns the wizard's answers into the files of a Crate home
// installation: .env, the compose stack and Traefik's configuration.
package install

import (
	"fmt"
	"net"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type AccessMode string

const (
	AccessPorts      AccessMode = "ports"
	AccessHosts      AccessMode = "hosts"
	AccessDNSMasq    AccessMode = "dnsmasq"
	AccessCloudflare AccessMode = "cloudflare"
)

// ParseAccessMode accepts the aliases install.sh accepted.
func ParseAccessMode(value string) (AccessMode, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "ports", "port", "localhost", "local-only":
		return AccessPorts, nil
	case "hosts", "host":
		return AccessHosts, nil
	case "dnsmasq", "dns":
		return AccessDNSMasq, nil
	case "cloudflare", "cf", "https":
		return AccessCloudflare, nil
	}
	return "", fmt.Errorf("unknown access mode %q: use ports, hosts, dnsmasq or cloudflare", value)
}

type Ports struct {
	HTTP, HTTPS, API, Admin, Listen int
}

func DefaultPorts() Ports {
	return Ports{HTTP: 80, HTTPS: 443, API: 8585, Admin: 8580, Listen: 8581}
}

// Config holds every answer of the wizard.
type Config struct {
	InstallDir   string
	MusicDir     string
	DataDir      string
	DownloadsDir string
	Timezone     string
	InstanceName string

	Access          AccessMode
	Domain          string
	CloudflareToken string
	Ports           Ports

	AdminPassword          string
	AdminPasswordGenerated bool

	ImageTag  string
	PUID      string
	PGID      string
	DockerGID string

	// Integrations holds the variables the integrations step set; an empty
	// value clears a variable that was configured before.
	Integrations map[string]string
	// Profiles are the optional compose services to run; nil keeps the
	// existing COMPOSE_PROFILES.
	Profiles []string
}

const LocalDomainDefault = "crate.local"

func Defaults(installDir string) Config {
	return Config{
		InstallDir:   installDir,
		MusicDir:     filepath.Join(installDir, "media", "music"),
		DataDir:      filepath.Join(installDir, "data"),
		DownloadsDir: filepath.Join(installDir, "media", "downloads", "soulseek"),
		Timezone:     "UTC",
		InstanceName: "Crate",
		Access:       AccessPorts,
		Domain:       "localhost",
		Ports:        DefaultPorts(),
		ImageTag:     "latest",
		PUID:         "1000",
		PGID:         "1000",
		DockerGID:    "988",
	}
}

var hostnamePattern = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$`)

func ValidateDomain(domain string) error {
	if domain == "localhost" {
		return nil
	}
	if !hostnamePattern.MatchString(domain) || !strings.Contains(domain, ".") {
		return fmt.Errorf("use a plain hostname such as crate.local or example.com")
	}
	if net.ParseIP(domain) != nil {
		return fmt.Errorf("use a hostname, not an IP address")
	}
	return nil
}

// URLs are the addresses users open once Crate is running.
type URLs struct {
	Admin, Listen, API string
}

func (c Config) LocalURLs() URLs {
	return URLs{
		Admin:  "http://localhost:" + strconv.Itoa(c.Ports.Admin),
		Listen: "http://localhost:" + strconv.Itoa(c.Ports.Listen),
		API:    "http://localhost:" + strconv.Itoa(c.Ports.API),
	}
}

// DomainURLs returns the hostnames Traefik serves, or false in ports mode.
func (c Config) DomainURLs() (URLs, bool) {
	switch c.Access {
	case AccessCloudflare:
		return URLs{
			Admin:  "https://admin." + c.Domain,
			Listen: "https://listen." + c.Domain,
			API:    "https://api." + c.Domain,
		}, true
	case AccessHosts, AccessDNSMasq:
		suffix := ""
		if c.Ports.HTTP != 80 {
			suffix = ":" + strconv.Itoa(c.Ports.HTTP)
		}
		return URLs{
			Admin:  "http://admin." + c.Domain + suffix,
			Listen: "http://listen." + c.Domain + suffix,
			API:    "http://api." + c.Domain + suffix,
		}, true
	}
	return URLs{}, false
}

// PublicURLs are the addresses other devices and peers should use.
func (c Config) PublicURLs() URLs {
	if urls, ok := c.DomainURLs(); ok {
		return urls
	}
	return c.LocalURLs()
}
