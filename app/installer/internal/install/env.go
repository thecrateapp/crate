package install

import (
	"strconv"
	"strings"

	"github.com/thecrateapp/crate/app/installer/internal/envfile"
	"github.com/thecrateapp/crate/app/installer/internal/manifest"
	"github.com/thecrateapp/crate/app/installer/internal/secrets"
)

// BuildEnv merges the answers into the values of an existing .env (or a new
// one). The wizard's answers always win; defaults it never asks about only
// fill gaps, so manual edits survive. Generated secrets are created only when
// missing, so reconfiguring never rotates the database password or JWT secret.
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
	public := cfg.PublicURLs()
	defaults := map[string]string{
		"CACHE_DIR":               cfg.DataDir + "/cache",
		"CRATE_IMAGE_OWNER":       "thecrateapp",
		"CRATE_IMAGE_REGISTRY":    "ghcr.io",
		"CRATE_CONFIG_FILE":       "./config.yaml",
		"POSTGRES_SUPERUSER_USER": "crate",
		"POSTGRES_SUPERUSER_DB":   "crate",
		"CRATE_POSTGRES_USER":     "crate",
		"CRATE_POSTGRES_DB":       "crate",
	}
	if accessChanged(cfg, existing) {
		values.Set("CRATE_LISTEN_PUBLIC_BASE_URL", public.Listen)
		values.Set("CRATE_PUBLIC_API_BASE_URL", public.API)
	} else {
		defaults["CRATE_LISTEN_PUBLIC_BASE_URL"] = public.Listen
		defaults["CRATE_PUBLIC_API_BASE_URL"] = public.API
	}
	for key, value := range defaults {
		if current, ok := values.Get(key); !ok || current == "" {
			values.Set(key, value)
		}
	}
	transient := m.Transient()
	for key, value := range cfg.Integrations {
		if !transient[key] {
			values.Set(key, value)
		}
	}
	if cfg.Profiles != nil {
		values.Set("COMPOSE_PROFILES", strings.Join(cfg.Profiles, ","))
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

// accessChanged reports a new installation or a different access mode or
// domain, the cases where the public URLs must follow the answers.
func accessChanged(cfg Config, existing *envfile.Values) bool {
	if existing == nil {
		return true
	}
	mode, _ := existing.Get("CRATE_ACCESS_MODE")
	domain, _ := existing.Get("DOMAIN")
	return mode != string(cfg.Access) || domain != domainValue(cfg)
}

func domainValue(cfg Config) string {
	if cfg.Access == AccessPorts {
		return "localhost"
	}
	return cfg.Domain
}

// answerValues are the settings the wizard asks for or derives directly.
func answerValues(cfg Config) map[string]string {
	tls, entrypoint, resolver := "false", "web", ""
	if cfg.Access == AccessCloudflare {
		tls, entrypoint, resolver = "true", "websecure", "letsencrypt"
	}
	values := map[string]string{
		"TZ":                        cfg.Timezone,
		"PUID":                      cfg.PUID,
		"PGID":                      cfg.PGID,
		"DOCKER_GID":                cfg.DockerGID,
		"MUSIC_DIR":                 cfg.MusicDir,
		"DATA_DIR":                  cfg.DataDir,
		"DOWNLOADS_DIR":             cfg.DownloadsDir,
		"DOMAIN":                    domainValue(cfg),
		"CRATE_INSTANCE_NAME":       cfg.InstanceName,
		"CRATE_ACCESS_MODE":         string(cfg.Access),
		"CRATE_LOCAL_DOMAIN":        localDomain(cfg),
		"CF_DNS_API_TOKEN":          cfg.CloudflareToken,
		"TRAEFIK_HTTP_PORT":         strconv.Itoa(cfg.Ports.HTTP),
		"TRAEFIK_HTTPS_PORT":        strconv.Itoa(cfg.Ports.HTTPS),
		"TRAEFIK_TLS_ENABLED":       tls,
		"TRAEFIK_SECURE_ENTRYPOINT": entrypoint,
		"TRAEFIK_CERT_RESOLVER":     resolver,
		"CRATE_API_PORT":            strconv.Itoa(cfg.Ports.API),
		"CRATE_ADMIN_PORT":          strconv.Itoa(cfg.Ports.Admin),
		"CRATE_LISTEN_PORT":         strconv.Itoa(cfg.Ports.Listen),
		"CRATE_IMAGE_TAG":           cfg.ImageTag,
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
