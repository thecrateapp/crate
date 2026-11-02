import type { ScaleFigure } from "../architecture/en";
import type { Feature } from "../../lib/chapters";

export type MapView = "3d" | "2d";

export const STACK_MAP = {
  label: "Stack",
  host: "host crate · two deployments",
  sample: "Sample data",
  views: "Map view",
  caption:
    "Admin's Stack page, captured with sample data. Each deployment on the host is a dome in 3D and a ring in 2D. Node size is memory, the spike is CPU, and the moving dots are requests, tasks and events from the last few seconds.",
  widths: [390, 768, 1440],
  sizes: "(min-width: 1480px) 1440px, 100vw",
  video: "/stack-map/stack-map-3d",
  images: {
    "3d": {
      image: "/stack-map/stack-map-3d",
      width: 1440,
      height: 645,
      alt: "Stack map in 3D: two domes on one host. The application dome is lit in cyan with the API at its top, request lines from Edge, Admin, Listen and Readplane, and dashed queue and data lines to PostgreSQL, Redis and the workers. The monitoring dome beside it is grey, with Prometheus at the centre and Grafana, cAdvisor and the exporters around it.",
    },
    "2d": {
      image: "/stack-map/stack-map-2d",
      width: 1440,
      height: 692,
      alt: "Stack map in 2D: two rings of services. The application ring has the API at the centre, with request lines from Edge, Admin, Listen and Readplane carrying moving dots, and dashed lines to PostgreSQL, Redis cache, Redis durable and the workers. The monitoring ring has Prometheus at the centre with Grafana and the exporters around it.",
    },
  } satisfies Record<
    MapView,
    { image: string; width: number; height: number; alt: string }
  >,
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
