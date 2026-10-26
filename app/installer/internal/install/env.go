package install

import (
	"strconv"
	"strings"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/secrets"
)

// BuildEnv merges the answers into the values of an existing .env (or a new
// one). Generated secrets are created only when missing, so reconfiguring
// an installation never rotates its database password or JWT secret.
func BuildEnv(m *manifest.Manifest, cfg Config, existing *envfile.Values) (*envfile.Values, error) {
	values := envfile.New()
	if existing != nil {
		for _, key := range existing.Keys() {
			value, _ := existing.Get(key)
			values.Set(key, value)
		}
	}
	for key, value := range answerValues(cfg) {
		values.Set(key, value)
	}
	for _, g := range m.Generated {
		if current, ok := values.Get(g.Env); ok && current != "" {
			continue
		}
		if source, ok := strings.CutPrefix(g.Format, "same:"); ok {
			value, _ := values.Get(source)
			values.Set(g.Env, value)
			continue
		}
		value, err := secrets.Generate(g.Format)
		if err != nil {
			return nil, err
		}
		values.Set(g.Env, value)
	}
	return values, nil
}

func answerValues(cfg Config) map[string]string {
	tls, entrypoint, resolver := "false", "web", ""
	if cfg.Access == AccessCloudflare {
		tls, entrypoint, resolver = "true", "websecure", "letsencrypt"
	}
	domain := cfg.Domain
	if cfg.Access == AccessPorts {
		domain = "localhost"
	}
	public := cfg.PublicURLs()
	values := map[string]string{
		"TZ":                           cfg.Timezone,
		"PUID":                         cfg.PUID,
		"PGID":                         cfg.PGID,
		"DOCKER_GID":                   cfg.DockerGID,
		"MUSIC_DIR":                    cfg.MusicDir,
		"DATA_DIR":                     cfg.DataDir,
		"CACHE_DIR":                    cfg.DataDir + "/cache",
		"DOWNLOADS_DIR":                cfg.DownloadsDir,
		"DOMAIN":                       domain,
		"CRATE_INSTANCE_NAME":          cfg.InstanceName,
		"CRATE_LISTEN_PUBLIC_BASE_URL": public.Listen,
		"CRATE_PUBLIC_API_BASE_URL":    public.API,
		"CRATE_ACCESS_MODE":            string(cfg.Access),
		"CRATE_LOCAL_DOMAIN":           localDomain(cfg),
		"CF_DNS_API_TOKEN":             cfg.CloudflareToken,
		"TRAEFIK_HTTP_PORT":            strconv.Itoa(cfg.Ports.HTTP),
		"TRAEFIK_HTTPS_PORT":           strconv.Itoa(cfg.Ports.HTTPS),
		"TRAEFIK_TLS_ENABLED":          tls,
		"TRAEFIK_SECURE_ENTRYPOINT":    entrypoint,
		"TRAEFIK_CERT_RESOLVER":        resolver,
		"CRATE_API_PORT":               strconv.Itoa(cfg.Ports.API),
		"CRATE_ADMIN_PORT":             strconv.Itoa(cfg.Ports.Admin),
		"CRATE_LISTEN_PORT":            strconv.Itoa(cfg.Ports.Listen),
		"CRATE_IMAGE_TAG":              cfg.ImageTag,
		"CRATE_IMAGE_OWNER":            "thecrateapp",
		"CRATE_IMAGE_REGISTRY":         "ghcr.io",
		"CRATE_CONFIG_FILE":            "./config.yaml",
		"POSTGRES_SUPERUSER_USER":      "crate",
		"POSTGRES_SUPERUSER_DB":        "crate",
		"CRATE_POSTGRES_USER":          "crate",
		"CRATE_POSTGRES_DB":            "crate",
	}
	if cfg.AdminPassword != "" {
		values["DEFAULT_ADMIN_PASSWORD"] = cfg.AdminPassword
	}
	return values
}

func localDomain(cfg Config) string {
	if cfg.Access == AccessHosts || cfg.Access == AccessDNSMasq {
		return cfg.Domain
	}
	return LocalDomainDefault
}

// Sections orders the written .env the way people read it.
func Sections(m *manifest.Manifest) []envfile.Section {
	core := make([]string, 0, len(m.Core))
	for _, s := range m.Core {
		core = append(core, s.Env)
	}
	generated := make([]string, 0, len(m.Generated))
	for _, g := range m.Generated {
		generated = append(generated, g.Env)
	}
	sections := []envfile.Section{
		{Title: "Installation", Keys: core},
		{Title: "Generated secrets — keep them; changing them breaks existing data", Keys: generated},
	}
	for _, in := range m.Integrations {
		keys := make([]string, 0, len(in.Env))
		for _, e := range in.Env {
			keys = append(keys, e.Name)
		}
		sections = append(sections, envfile.Section{Title: in.Title, Keys: keys})
	}
	sections = append(sections, envfile.Section{Title: "Tuning", Keys: m.Tuning})
	return sections
}

const EnvHeader = "# Crate home installation, written by `crate install`.\n# Run `crate install` again to change it; manual edits are kept.\n"
