import type { ScaleFigure } from "../architecture/en";
import type { Feature } from "../../lib/chapters";

export type StackId = "application" | "observability";
export type Link = "request" | "data" | "queue" | "telemetry";

export interface MapNode {
  id: string;
  label: string;
  x: number;
  y: number;
  hub?: boolean;
  reading?: string;
}

export interface MapStack {
  id: StackId;
  name: string;
  nodes: MapNode[];
  links: [string, string, Link][];
}

export const MAP_HEADINGS = {
  label: "Stack",
  host: "host crate · two deployments",
  sample: "Sample readings",
  live: "While the page is open",
};

export const STACKS: MapStack[] = [
  {
    id: "application",
    name: "Application",
    nodes: [
      { id: "crate-listen", label: "Listen", x: 18, y: 10 },
      { id: "traefik", label: "Edge", x: 50, y: 10, reading: "64 req/min" },
      { id: "crate-ui", label: "Admin", x: 82, y: 10 },
      { id: "crate-readplane", label: "Readplane", x: 16, y: 32 },
      {
        id: "crate-api",
        label: "API",
        x: 50,
        y: 40,
        hub: true,
        reading: "6% · 1.1 GiB",
      },
      { id: "crate-projector", label: "Projector", x: 84, y: 32 },
      { id: "crate-worker", label: "Worker", x: 16, y: 54 },
      { id: "crate-fast-worker", label: "Fast worker", x: 84, y: 54 },
      { id: "crate-maintenance-worker", label: "Maintenance", x: 12, y: 72 },
      {
        id: "crate-analysis-worker",
        label: "Analysis",
        x: 37,
        y: 70,
        reading: "41% · 640 MiB",
      },
      { id: "crate-playback-worker", label: "Playback", x: 63, y: 70 },
      { id: "crate-media-worker", label: "Media", x: 88, y: 72 },
      { id: "crate-postgres", label: "PostgreSQL", x: 20, y: 90 },
      { id: "crate-redis", label: "Redis cache", x: 50, y: 90 },
      { id: "crate-redis-durable", label: "Redis durable", x: 80, y: 90 },
    ],
    links: [
      ["traefik", "crate-listen", "request"],
      ["traefik", "crate-ui", "request"],
      ["traefik", "crate-api", "request"],
      ["traefik", "crate-readplane", "request"],
      ["crate-listen", "crate-readplane", "request"],
      ["crate-ui", "crate-api", "request"],
      ["crate-readplane", "crate-api", "request"],
      ["crate-api", "crate-postgres", "data"],
      ["crate-api", "crate-redis", "data"],
      ["crate-api", "crate-redis-durable", "queue"],
      ["crate-worker", "crate-redis-durable", "queue"],
      ["crate-fast-worker", "crate-redis-durable", "queue"],
      ["crate-maintenance-worker", "crate-postgres", "data"],
      ["crate-analysis-worker", "crate-postgres", "data"],
      ["crate-playback-worker", "crate-redis-durable", "queue"],
      ["crate-media-worker", "crate-redis", "data"],
      ["crate-projector", "crate-postgres", "data"],
      ["crate-projector", "crate-redis-durable", "queue"],
    ],
  },
  {
    id: "observability",
    name: "Observability",
    nodes: [
      { id: "crate-grafana", label: "Grafana", x: 50, y: 10 },
      { id: "crate-node-exporter", label: "Host exporter", x: 24, y: 32 },
      {
        id: "crate-prometheus",
        label: "Prometheus",
        x: 50,
        y: 46,
        hub: true,
        reading: "2% · 310 MiB",
      },
      { id: "crate-cadvisor", label: "cAdvisor", x: 78, y: 28 },
      {
        id: "crate-observability-docker-proxy",
        label: "Read proxy",
        x: 80,
        y: 58,
      },
      { id: "crate-postgres-exporter", label: "PG exporter", x: 24, y: 72 },
      { id: "crate-redis-exporter", label: "Cache exporter", x: 50, y: 88 },
      {
        id: "crate-redis-durable-exporter",
        label: "Broker exporter",
        x: 74,
        y: 76,
      },
    ],
    links: [
      ["crate-grafana", "crate-prometheus", "request"],
      ["crate-cadvisor", "crate-observability-docker-proxy", "telemetry"],
      ["crate-prometheus", "crate-node-exporter", "telemetry"],
      ["crate-prometheus", "crate-cadvisor", "telemetry"],
      ["crate-prometheus", "crate-postgres-exporter", "telemetry"],
      ["crate-prometheus", "crate-redis-exporter", "telemetry"],
      ["crate-prometheus", "crate-redis-durable-exporter", "telemetry"],
    ],
  },
];

export const LIVE_READINGS = {
  host: { cpu: "23%", memory: "8.0 of 62.6 GiB" },
  clients: [
    { client: "listen-web", label: "Listen web", perMinute: 31 },
    { client: "listen-android", label: "Android", perMinute: 17 },
    { client: "listen-ios", label: "iOS", perMinute: 6 },
    { client: "listen-desktop", label: "Desktop", perMinute: 3 },
    { client: "admin-web", label: "Admin", perMinute: 5 },
    { client: "subsonic", label: "Subsonic", perMinute: 2 },
  ],
  listening: 3,
  tasksPerMinute: 4,
};

export const FEATURES: Feature[] = [
  {
    title: "Stack map",
    body: "The host, the application and the monitoring stack as one map, built from Docker. While the page is open it shows requests per client, tasks per queue and devices listening now. CPU and memory per service come from Prometheus and requests through Edge from Traefik. There is an optional 3D view.",
  },
  {
    title: "System Health",
    body: "API, stream, transcode, Home and worker metrics per minute, kept for eight days. Every figure says whether it is current, partial or stale, and a missing value is never drawn as zero.",
  },
  {
    title: "Playback health",
    body: "Listen reports each play request, how it ended and why, how long it ran and every stall. System Health shows start success and stall time over the last 15 minutes and hides the ratios until 20 plays have been attempted.",
  },
  {
    title: "Recommendation signals",
    body: "Radio batches and Music Paths plans record how full they were and how they were built. Listen reports what happened when the queue ran out, and an hourly task measures how often radio and path tracks are skipped in their first 30 seconds.",
  },
  {
    title: "Product",
    body: "Daily figures for the whole server: listeners, plays and listening time, library growth, acquisition, engagement and federation. Segments with fewer than three listeners are hidden.",
  },
  {
    title: "Prometheus and Grafana",
    body: "An optional monitoring stack scrapes the host, the containers, PostgreSQL, Redis and the application itself. Grafana stays on the server's loopback, and its dashboards cover playback, workers and whether collection itself is working.",
    status: "opt-in",
  },
  {
    title: "Alerts in Telegram",
    body: "Crate Operator reads a fixed set of Prometheus rules directly, so an alert still arrives when the API is down. New rules ship switched off and are turned on one at a time.",
    status: "opt-in",
  },
  {
    title: "For agents",
    body: "get_playback_quality, get_product_kpis and get_stack_status give an AI agent the same readings, read only, through the Crate MCP.",
    status: "opt-in",
    link: { href: "#mcp", label: "Via MCP" },
  },
];

export const FIGURES: ScaleFigure[] = [
  { value: 78, label: "Metric families in Prometheus" },
  { value: 29, label: "Recording rules" },
  { value: 6, label: "Grafana dashboards" },
];

export const FIGURES_NOTE =
  "With the optional monitoring stack. Without it, System Health, the Stack map and Product still work from the server's own history.";

export const NEVER_LABEL = "Telemetry never carries";

export const NEVER = [
  "Track, album or artist IDs",
  "File paths",
  "Credentials",
  "Free text in labels",
];
