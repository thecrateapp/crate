package install

import (
	"strconv"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
)

// FromEnvFile prefills the answers from an existing installation's .env.
func FromEnvFile(base Config, values *envfile.Values) Config {
	get := func(key string) (string, bool) {
		value, ok := values.Get(key)
		return value, ok && value != ""
	}
	cfg := base
	setString(&cfg.MusicDir, get, "MUSIC_DIR")
	setString(&cfg.DataDir, get, "DATA_DIR")
	setString(&cfg.DownloadsDir, get, "DOWNLOADS_DIR")
	setString(&cfg.Timezone, get, "TZ")
	setString(&cfg.InstanceName, get, "CRATE_INSTANCE_NAME")
	setString(&cfg.CloudflareToken, get, "CF_DNS_API_TOKEN")
	setString(&cfg.ImageTag, get, "CRATE_IMAGE_TAG")
	setString(&cfg.PUID, get, "PUID")
	setString(&cfg.PGID, get, "PGID")
	setString(&cfg.DockerGID, get, "DOCKER_GID")
	if mode, ok := get("CRATE_ACCESS_MODE"); ok {
		if access, err := ParseAccessMode(mode); err == nil {
			cfg.Access = access
		}
	}
	setString(&cfg.Domain, get, "DOMAIN")
	setPorts(&cfg.Ports, get)
	return cfg
}

// WithOverrides applies the environment variables install.sh accepted, so
// existing automation keeps working with `crate install --yes`.
func WithOverrides(base Config, getenv func(string) string) (Config, error) {
	get := func(key string) (string, bool) {
		value := getenv(key)
		return value, value != ""
	}
	cfg := base
	setString(&cfg.MusicDir, get, "CRATE_MUSIC_DIR")
	setString(&cfg.DataDir, get, "CRATE_DATA_DIR")
	setString(&cfg.DownloadsDir, get, "CRATE_DOWNLOADS_DIR")
	setString(&cfg.Timezone, get, "TZ")
	setString(&cfg.InstanceName, get, "CRATE_INSTANCE_NAME")
	setString(&cfg.CloudflareToken, get, "CF_DNS_API_TOKEN")
	setString(&cfg.ImageTag, get, "CRATE_IMAGE_TAG")
	setString(&cfg.AdminPassword, get, "DEFAULT_ADMIN_PASSWORD")
	if mode, ok := get("CRATE_ACCESS_MODE"); ok {
		access, err := ParseAccessMode(mode)
		if err != nil {
			return cfg, err
		}
		cfg.Access = access
		if access == AccessHosts || access == AccessDNSMasq {
			cfg.Domain = LocalDomainDefault
		}
	}
	setString(&cfg.Domain, get, "CRATE_DOMAIN")
	setPorts(&cfg.Ports, get)
	return cfg, nil
}

func setString(target *string, get func(string) (string, bool), key string) {
	if value, ok := get(key); ok {
		*target = value
	}
}

func setPorts(ports *Ports, get func(string) (string, bool)) {
	for key, target := range map[string]*int{
		"TRAEFIK_HTTP_PORT":  &ports.HTTP,
		"TRAEFIK_HTTPS_PORT": &ports.HTTPS,
		"CRATE_API_PORT":     &ports.API,
		"CRATE_ADMIN_PORT":   &ports.Admin,
		"CRATE_LISTEN_PORT":  &ports.Listen,
	} {
		if value, ok := get(key); ok {
			if port, err := strconv.Atoi(value); err == nil && port > 0 && port < 65536 {
				*target = port
			}
		}
	}
}
