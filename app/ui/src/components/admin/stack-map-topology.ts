import type {
  StackMapActivityRole,
  StackMapConnection,
  StackMapTier,
} from "./stack-map-model";

export interface StackMapServiceDeclaration {
  label: string;
  description: string;
  stack: "application" | "observability";
  tier: StackMapTier;
  order: number;
}

export const STACK_SERVICE_CATALOG: Record<string, StackMapServiceDeclaration> =
  {
    "crate-api": {
      label: "API",
      description:
        "The application control plane. Library, acquisition and playback commands.",
      stack: "application",
      tier: "service",
      order: 0,
    },
    "crate-ui": {
      label: "Admin",
      description:
        "Library operations, maintenance and infrastructure inspection.",
      stack: "application",
      tier: "entry",
      order: 1,
    },
    traefik: {
      label: "Edge",
      description: "HTTPS entry point and routing to the application services.",
      stack: "application",
      tier: "entry",
      order: 2,
    },
    "crate-listen": {
      label: "Listen",
      description:
        "The listening application, including web and native clients.",
      stack: "application",
      tier: "entry",
      order: 3,
    },
    "crate-readplane": {
      label: "Readplane",
      description:
        "Low-latency library snapshots, catalog reads and event delivery.",
      stack: "application",
      tier: "service",
      order: 4,
    },
    "crate-projector": {
      label: "Projector",
      description: "Domain events projected into warmed application snapshots.",
      stack: "application",
      tier: "service",
      order: 5,
    },
    "crate-analysis-worker": {
      label: "Analysis",
      description: "Audio analysis, feature extraction and similarity vectors.",
      stack: "application",
      tier: "service",
      order: 6,
    },
    "crate-maintenance-worker": {
      label: "Maintenance",
      description: "Library repair, synchronization and enrichment.",
      stack: "application",
      tier: "service",
      order: 7,
    },
    "crate-worker": {
      label: "Worker",
      description:
        "Default and fast task execution with the service scheduler.",
      stack: "application",
      tier: "service",
      order: 8,
    },
    "crate-fast-worker": {
      label: "Fast worker",
      description:
        "Additional capacity for short tasks and interactive operations.",
      stack: "application",
      tier: "service",
      order: 9,
    },
    "crate-playback-worker": {
      label: "Playback",
      description: "Stream preparation and audio transcoding.",
      stack: "application",
      tier: "service",
      order: 10,
    },
    "crate-media-worker": {
      label: "Media",
      description: "Album and track package generation.",
      stack: "application",
      tier: "service",
      order: 11,
    },
    "crate-postgres": {
      label: "PostgreSQL",
      description: "The durable library, application state and snapshot store.",
      stack: "application",
      tier: "data",
      order: 12,
    },
    "crate-redis": {
      label: "Redis cache",
      description: "Short-lived cache, stream slots and request coordination.",
      stack: "application",
      tier: "data",
      order: 13,
    },
    "crate-redis-durable": {
      label: "Redis durable",
      description: "Task broker, event streams and durable coordination.",
      stack: "application",
      tier: "data",
      order: 14,
    },
    "crate-prometheus": {
      label: "Prometheus",
      description:
        "Infrastructure time series, scrape health and recording rules.",
      stack: "observability",
      tier: "service",
      order: 15,
    },
    "crate-grafana": {
      label: "Grafana",
      description:
        "Provisioned dashboards and historical infrastructure exploration.",
      stack: "observability",
      tier: "entry",
      order: 16,
    },
    "crate-node-exporter": {
      label: "Host exporter",
      description: "Host CPU, memory, filesystem and load observations.",
      stack: "observability",
      tier: "service",
      order: 17,
    },
    "crate-cadvisor": {
      label: "cAdvisor",
      description:
        "Resource observations for application and monitoring containers.",
      stack: "observability",
      tier: "service",
      order: 18,
    },
    "crate-postgres-exporter": {
      label: "PG exporter",
      description:
        "Read-only PostgreSQL statistics and connection observations.",
      stack: "observability",
      tier: "service",
      order: 19,
    },
    "crate-redis-exporter": {
      label: "Cache exporter",
      description: "Cache Redis memory, commands and connection observations.",
      stack: "observability",
      tier: "service",
      order: 20,
    },
    "crate-redis-durable-exporter": {
      label: "Broker exporter",
      description:
        "Durable Redis observations, collected separately from cache.",
      stack: "observability",
      tier: "service",
      order: 21,
    },
    "crate-observability-docker-proxy": {
      label: "Read proxy",
      description:
        "Restricted read access for the container resource collector.",
      stack: "observability",
      tier: "service",
      order: 22,
    },
  };

export const STACK_HUBS: Record<"application" | "observability", string> = {
  application: "crate-api",
  observability: "crate-prometheus",
};

export const STACK_ACTIVITY_ROLES: Partial<
  Record<string, StackMapActivityRole>
> = {
  "crate-api": { measures: ["requests"] },
  "crate-ui": { clients: ["admin-web"] },
  "crate-listen": {
    clients: ["listen-web", "listen-android", "listen-ios", "listen-desktop"],
    measures: ["listening"],
  },
  "crate-readplane": { clients: ["readplane"] },
  "crate-worker": { queues: ["default", "fast"] },
  "crate-fast-worker": { queues: ["fast"] },
  "crate-maintenance-worker": { queues: ["maintenance"] },
  "crate-analysis-worker": { queues: ["heavy"] },
  "crate-playback-worker": { queues: ["playback"] },
  "crate-projector": { measures: ["events"] },
};

export const STACK_CONNECTIONS: [string, string, StackMapConnection["kind"]][] =
  [
    ["traefik", "crate-listen", "request"],
    ["traefik", "crate-ui", "request"],
    ["crate-listen", "crate-readplane", "request"],
    ["crate-listen", "crate-api", "request"],
    ["crate-ui", "crate-api", "request"],
    ["crate-readplane", "crate-api", "request"],
    ["crate-readplane", "crate-postgres", "data"],
    ["crate-api", "crate-postgres", "data"],
    ["crate-api", "crate-redis", "data"],
    ["crate-api", "crate-redis-durable", "queue"],
    ["crate-worker", "crate-redis-durable", "queue"],
    ["crate-fast-worker", "crate-redis-durable", "queue"],
    ["crate-maintenance-worker", "crate-postgres", "data"],
    ["crate-maintenance-worker", "crate-redis-durable", "queue"],
    ["crate-analysis-worker", "crate-postgres", "data"],
    ["crate-analysis-worker", "crate-redis-durable", "queue"],
    ["crate-playback-worker", "crate-redis-durable", "queue"],
    ["crate-media-worker", "crate-redis", "data"],
    ["crate-projector", "crate-postgres", "data"],
    ["crate-projector", "crate-redis-durable", "queue"],
    ["crate-grafana", "crate-prometheus", "request"],
    ["crate-cadvisor", "crate-observability-docker-proxy", "telemetry"],
    ["crate-postgres-exporter", "crate-postgres", "telemetry"],
    ["crate-redis-exporter", "crate-redis", "telemetry"],
    ["crate-redis-durable-exporter", "crate-redis-durable", "telemetry"],
    ["crate-prometheus", "crate-node-exporter", "telemetry"],
    ["crate-prometheus", "crate-cadvisor", "telemetry"],
    ["crate-prometheus", "crate-postgres-exporter", "telemetry"],
    ["crate-prometheus", "crate-redis-exporter", "telemetry"],
    ["crate-prometheus", "crate-redis-durable-exporter", "telemetry"],
  ];
