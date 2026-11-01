import type {
  StackMapActivityRole,
  StackMapSnapshot,
  StackMapService,
  StackMapTier,
} from "../../../app/ui/src/components/admin/stack-map-model";
import type { StackActivityFrame } from "../../../app/ui/src/components/admin/stack-map-activity";

export type StackMapSample = "observed" | "degraded" | "stale" | "unavailable";

const application = [
  [
    "crate-api",
    "API",
    "The application control plane. Library, acquisition and playback commands.",
    3.2,
    624,
  ],
  [
    "crate-ui",
    "Admin",
    "Library operations, maintenance and infrastructure inspection.",
    0,
    28,
  ],
  [
    "traefik",
    "Edge",
    "HTTPS entry point and routing to the application services.",
    0.2,
    82,
  ],
  [
    "crate-listen",
    "Listen",
    "The listening application, including web and native clients.",
    0,
    32,
  ],
  [
    "crate-readplane",
    "Readplane",
    "Low-latency library snapshots, catalog reads and event delivery.",
    1.4,
    188,
  ],
  [
    "crate-projector",
    "Projector",
    "Domain events projected into warmed application snapshots.",
    2.7,
    312,
  ],
  [
    "crate-analysis-worker",
    "Analysis",
    "Audio analysis, feature extraction and similarity vectors.",
    33.6,
    1600,
  ],
  [
    "crate-maintenance-worker",
    "Maintenance",
    "Library repair, synchronization and enrichment.",
    0.8,
    380,
  ],
  [
    "crate-worker",
    "Worker",
    "Default and fast task execution with the service scheduler.",
    18.2,
    1014,
  ],
  [
    "crate-fast-worker",
    "Fast worker",
    "Additional capacity for short tasks and interactive operations.",
    4.3,
    400,
  ],
  [
    "crate-playback-worker",
    "Playback",
    "Stream preparation and audio transcoding.",
    0.4,
    420,
  ],
  [
    "crate-media-worker",
    "Media",
    "Album and track package generation.",
    0.1,
    94,
  ],
  [
    "crate-postgres",
    "PostgreSQL",
    "The durable library, application state and snapshot store.",
    16.1,
    7420,
  ],
  [
    "crate-redis",
    "Redis cache",
    "Short-lived cache, stream slots and request coordination.",
    0.4,
    280,
  ],
  [
    "crate-redis-durable",
    "Redis durable",
    "Task broker, event streams and durable coordination.",
    0.1,
    140,
  ],
] as const;

const observability = [
  [
    "crate-prometheus",
    "Prometheus",
    "Infrastructure time series, scrape health and recording rules.",
    12.6,
    192,
  ],
  [
    "crate-grafana",
    "Grafana",
    "Provisioned dashboards and historical infrastructure exploration.",
    1.8,
    282,
  ],
  [
    "crate-node-exporter",
    "Host exporter",
    "Host CPU, memory, filesystem and load observations.",
    0.2,
    12,
  ],
  [
    "crate-cadvisor",
    "cAdvisor",
    "Resource observations for application and monitoring containers.",
    0.5,
    55,
  ],
  [
    "crate-postgres-exporter",
    "PG exporter",
    "Read-only PostgreSQL statistics and connection observations.",
    0.1,
    34,
  ],
  [
    "crate-redis-exporter",
    "Cache exporter",
    "Cache Redis memory, commands and connection observations.",
    0.1,
    11,
  ],
  [
    "crate-redis-durable-exporter",
    "Broker exporter",
    "Durable Redis observations, collected separately from cache.",
    0.1,
    11,
  ],
  [
    "crate-observability-docker-proxy",
    "Read proxy",
    "Restricted read access for the container resource collector.",
    0.1,
    4,
  ],
] as const;

const TIERS: Partial<Record<string, StackMapTier>> = {
  traefik: "entry",
  "crate-listen": "entry",
  "crate-ui": "entry",
  "crate-postgres": "data",
  "crate-redis": "data",
  "crate-redis-durable": "data",
  "crate-grafana": "entry",
};

const ACTIVITY: Partial<Record<string, StackMapActivityRole>> = {
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

export function createStackMapSample(
  sample: StackMapSample = "observed",
): StackMapSnapshot {
  const services: StackMapService[] = [
    ...application.map((row) => ({ row, stackId: "application" })),
    ...observability.map((row) => ({ row, stackId: "observability" })),
  ].map(
    (
      { row: [id, label, description, cpuPercent, memoryMiB], stackId },
      order,
    ) => ({
      order,
      id,
      label,
      description,
      cpuPercent,
      memoryMiB,
      stackId,
      runtimeState: "running",
      health: "healthy",
      tier: TIERS[id] ?? "service",
      activity: ACTIVITY[id],
    }),
  );
  if (sample === "degraded") {
    for (const service of services)
      if (["crate-postgres", "crate-postgres-exporter"].includes(service.id)) {
        service.health = "unhealthy";
        service.cpuPercent = service.id === "crate-postgres" ? 94.6 : 0.2;
      }
  }
  const connection = (
    source: string,
    target: string,
    kind: StackMapSnapshot["connections"][number]["kind"],
  ) => ({ source, target, kind });
  return {
    host: {
      id: "production",
      name: "Crate production",
      address: "95.216.3.27",
      cpuPercent: sample === "degraded" ? 82.1 : 29.4,
      memoryUsedGiB: 21.7,
      memoryTotalGiB: 62,
    },
    stacks: [
      {
        id: "application",
        name: "Application",
        kind: "application",
        hubId: "crate-api",
        revision: "6681be8",
      },
      {
        id: "observability",
        name: "Observability",
        kind: "observability",
        hubId: "crate-prometheus",
        revision: "b412f2d",
      },
    ],
    services,
    connections: [
      connection("traefik", "crate-listen", "request"),
      connection("traefik", "crate-ui", "request"),
      connection("crate-listen", "crate-readplane", "request"),
      connection("crate-listen", "crate-api", "request"),
      connection("crate-ui", "crate-api", "request"),
      connection("crate-readplane", "crate-api", "request"),
      connection("crate-readplane", "crate-postgres", "data"),
      connection("crate-api", "crate-postgres", "data"),
      connection("crate-api", "crate-redis", "data"),
      connection("crate-api", "crate-redis-durable", "queue"),
      connection("crate-worker", "crate-redis-durable", "queue"),
      connection("crate-fast-worker", "crate-redis-durable", "queue"),
      connection("crate-maintenance-worker", "crate-postgres", "data"),
      connection("crate-maintenance-worker", "crate-redis-durable", "queue"),
      connection("crate-analysis-worker", "crate-postgres", "data"),
      connection("crate-analysis-worker", "crate-redis-durable", "queue"),
      connection("crate-playback-worker", "crate-redis-durable", "queue"),
      connection("crate-media-worker", "crate-redis", "data"),
      connection("crate-projector", "crate-postgres", "data"),
      connection("crate-projector", "crate-redis-durable", "queue"),
      connection("crate-grafana", "crate-prometheus", "request"),
      ...[
        "crate-node-exporter",
        "crate-cadvisor",
        "crate-postgres-exporter",
        "crate-redis-exporter",
        "crate-redis-durable-exporter",
      ].map((id) => connection("crate-prometheus", id, "telemetry")),
      connection(
        "crate-cadvisor",
        "crate-observability-docker-proxy",
        "telemetry",
      ),
      connection("crate-postgres-exporter", "crate-postgres", "telemetry"),
      connection("crate-redis-exporter", "crate-redis", "telemetry"),
      connection(
        "crate-redis-durable-exporter",
        "crate-redis-durable",
        "telemetry",
      ),
    ],
    availability:
      sample === "stale" || sample === "unavailable" ? sample : "available",
    observedAt: new Date(
      Date.now() - (sample === "stale" ? 12 * 60_000 : 30_000),
    ).toISOString(),
    metricsSource: sample === "unavailable" ? null : "prometheus",
  };
}

export type StackActivitySample =
  | "off"
  | "replay"
  | "warming"
  | "paused"
  | "unavailable";

const RECORDED_ACTIVITY: Omit<
  StackActivityFrame,
  "schema" | "sequence" | "observed_at" | "availability" | "sources"
>[] = [
  {
    window_seconds: 5,
    requests: {
      "listen-web": { count: 14, errors: 0 },
      "listen-android": { count: 5, errors: 0 },
      readplane: { count: 3, errors: 0 },
      "admin-web": { count: 6, errors: 0 },
    },
    queues: {
      default: { completed: 2, failed: 0 },
      heavy: { completed: 1, failed: 0 },
    },
    projector: { events: 3 },
    listening: 3,
  },
  {
    window_seconds: 5,
    requests: {
      "listen-web": { count: 9, errors: 0 },
      "admin-web": { count: 11, errors: 1 },
    },
    queues: {
      maintenance: { completed: 1, failed: 0 },
      fast: { completed: 4, failed: 0 },
    },
    projector: { events: 0 },
    listening: 3,
  },
  {
    window_seconds: 5,
    requests: {
      "listen-web": { count: 22, errors: 0 },
      "listen-ios": { count: 2, errors: 0 },
      readplane: { count: 1, errors: 0 },
    },
    queues: {
      playback: { completed: 2, failed: 0 },
      heavy: { completed: 2, failed: 1 },
    },
    projector: { events: 6 },
    listening: 4,
  },
];

export function createStackActivitySample(
  sample: StackActivitySample,
  index: number,
  now = Date.now(),
): StackActivityFrame | null | undefined {
  if (sample === "off") return undefined;
  if (sample === "unavailable") return null;
  const recorded = RECORDED_ACTIVITY[index % RECORDED_ACTIVITY.length]!;
  const sources = {
    metrics: "available",
    playback: "available",
    projector: "available",
  };
  if (sample === "warming")
    return {
      ...recorded,
      schema: 1,
      sequence: index + 1,
      observed_at: new Date(now).toISOString(),
      availability: "warming",
      window_seconds: null,
      requests: null,
      queues: null,
      sources: { ...sources, metrics: "warming" },
    };
  return {
    ...recorded,
    schema: 1,
    sequence: index + 1,
    observed_at: new Date(
      sample === "paused" ? now - 120_000 : now,
    ).toISOString(),
    availability: "available",
    sources,
  };
}
