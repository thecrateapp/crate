package install

import "strings"

const traefikCommon = `global:
  checkNewVersion: true
  sendAnonymousUsage: false

log:
  level: INFO
  filePath: "/var/log/traefik/traefik.log"

accessLog:
  filePath: "/var/log/traefik/access.log"
  bufferingSize: 100

api:
  dashboard: true
`

const traefikMetricsEntryPoint = `
  metrics:
    address: ":8082"
`

const traefikMetrics = `
metrics:
  prometheus:
    entryPoint: metrics
    addRoutersLabels: true
    addServicesLabels: true
`

const traefikProviders = `
providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    network: crate
    exposedByDefault: false

  file:
    directory: /conf
    watch: true
`

// TraefikStatic renders traefik.yml. Cloudflare mode redirects HTTP to HTTPS
// and issues Let's Encrypt certificates through a DNS challenge.
func TraefikStatic(cfg Config) string {
	var b strings.Builder
	b.WriteString(traefikCommon)
	if cfg.Access != AccessCloudflare {
		b.WriteString(`
entryPoints:
  web:
    address: ":80"

  websecure:
    address: ":443"
`)
		b.WriteString(traefikMetricsEntryPoint)
		b.WriteString(traefikProviders)
		b.WriteString(traefikMetrics)
		return b.String()
	}
	b.WriteString(`
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true

  websecure:
    address: ":443"
`)
	b.WriteString(traefikMetricsEntryPoint)
	b.WriteString(traefikProviders)
	b.WriteString(traefikMetrics)
	b.WriteString(`
certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@` + cfg.Domain + `
      storage: /acme.json
      keyType: EC384
      dnsChallenge:
        provider: cloudflare
        resolvers:
          - "1.1.1.1:53"
          - "1.0.0.1:53"

tls:
  options:
    default:
      minVersion: VersionTLS12
`)
	return b.String()
}

const TraefikDynamic = `http:
  middlewares: {}
`
