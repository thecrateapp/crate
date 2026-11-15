import type { ScaleFigure } from "../architecture/en";
import sample from "./stack-map-sample.json";

const DOCS = "https://docs.cratemusic.app";

export const SAMPLE = sample;

export const STACK_MAP = {
  label: "Stack",
  host: "host crate · two deployments · live while the page is open",
  sample: "Sample data",
  caption:
    "Admin's Stack page, captured with sample data. The readings above come from the same sample.",
  widths: [390, 768, 1440],
  sizes: "(min-width: 1600px) 1600px, 100vw",
  video: "/stack-map/stack-map-3d",
  image: {
    image: "/stack-map/stack-map-3d",
    width: 1440,
    height: 645,
    alt: "Stack map in 3D: two domes on one host. The application dome is lit in cyan with the API at its top, request lines from Edge, Admin, Listen and Readplane, and dashed queue and data lines to PostgreSQL, Redis and the workers. The monitoring dome beside it is grey, with Prometheus at the centre and Grafana, cAdvisor and the exporters around it.",
  },
  portrait: {
    image: "/stack-map/stack-map-3d-portrait-780.webp",
    width: 780,
    height: 897,
    media: "(max-width: 760px)",
  },
};

const services = sample.application.length + sample.observability.length;

export const READINGS = [
  {
    label: "Listening now",
    value: String(sample.activity.listening),
    unit: "devices",
  },
  { label: "Host CPU", value: String(sample.host.cpu_percent), unit: "%" },
  {
    label: "Host memory",
    value: sample.host.memory_used_gib.toFixed(1),
    unit: `/ ${sample.host.memory_total_gib} GiB`,
  },
  { label: "Services", value: String(services), unit: "in 2 deployments" },
];

export const CLIENTS: Record<string, string> = {
  "listen-web": "Listen web",
  "listen-android": "Android",
  "listen-ios": "iOS",
  "listen-desktop": "Desktop",
  "admin-web": "Admin",
  subsonic: "Subsonic",
};

export const EDGE: Record<string, string> = {
  listen: "listen",
  admin: "admin",
  "crate-api": "api",
  "crate-readplane-interactive": "readplane",
};

export const FLOWS = [
  { key: "Requests", meta: "per client", items: Object.values(CLIENTS) },
  {
    key: "Tasks",
    meta: "per queue",
    items: Object.keys(sample.activity.queues),
  },
  {
    key: "Edge",
    meta: "via Traefik",
    items: Object.keys(sample.activity.ingress).map((router) => EDGE[router]!),
  },
];

export const LEGEND = [
  { glyph: "dome", label: "Dome", body: "One deployment on the host." },
  { glyph: "node", label: "Node size", body: "Memory the service uses." },
  { glyph: "spike", label: "Spike", body: "Its CPU right now." },
  {
    glyph: "dots",
    label: "Moving dots",
    body: "Requests, tasks and events from the last few seconds.",
  },
];

export const LEGEND_NOTE =
  "CPU and memory come from Prometheus when the monitoring stack runs. A service without a reading shows nothing rather than zero, and the sampler stops when nobody has the page open.";

export const HEADINGS = {
  gap: "A missing reading is never drawn as zero.",
  gapLede:
    "Every figure in Admin says how fresh it is. When collection loses minutes, the chart leaves them empty and the window reads as partial.",
  journey: "From a play to an alert",
};

export const GAP = {
  label: "System Health",
  meta: "requests per minute · last 60 min",
  state: "partial · source gap",
  minutes: 60,
  gap: [31, 38] as const,
  callout: "source gap · nothing drawn",
  aria: "Sample chart of one hour of requests per minute. Collection lost eight minutes, so those minutes have no bar and the window reads as partial.",
};

export function gapSeries(): (number | null)[] {
  return Array.from({ length: GAP.minutes }, (_, minute) => {
    if (minute >= GAP.gap[0] && minute <= GAP.gap[1]) return null;
    const wave =
      0.55 + 0.25 * Math.sin(minute / 6) + 0.12 * Math.sin(minute * 1.7);
    return Math.round(wave * 100) / 100;
  });
}

export const STATES = [
  {
    key: "available",
    label: "Available",
    body: "Every minute in the window was collected.",
  },
  {
    key: "partial",
    label: "Partial",
    body: "Collection recorded a gap in the window, for example after Redis restarted. The gap stays empty.",
  },
  {
    key: "stale",
    label: "Stale",
    body: "The collector has not checked in for more than ten minutes.",
  },
  {
    key: "empty",
    label: "Empty",
    body: "The source answered and nothing was observed in the window.",
  },
  {
    key: "unavailable",
    label: "Unavailable",
    body: "The source could not be read. Admin says so and draws no line.",
  },
] as const;

export const QOE_EVENT = {
  event: "result",
  outcome: "started",
  origin: "local",
  runtime: "android_native",
  engine: "media3",
  attempt: 1,
};

export const PLAYBACK = {
  successPercent: 98,
  started: 39,
  attempts: 40,
  minimumAttempts: 20,
};

export const PRODUCT_CROP = {
  image: "/observability/product-plays-by-platform.webp",
  width: 828,
  height: 402,
  label: "Product",
  meta: "in Admin · last 30 days",
  alt: "Plays by platform in Admin's Product page with sample data: Android 9,089 plays, 72.8%, web 3,389, 27.2%. iOS reads Hidden, fewer than 3 listeners.",
};

export const RULE = "crate:playback_stalls_per_startup:ratio15m";

export const ALERT_STATES = [
  { tone: "pending", label: "shadow period · 7 to 14 days" },
  { tone: "pending", label: "new rules · off" },
  { tone: "on", label: "enabled one by one" },
];

export const MCP_TOOLS = [
  "get_playback_quality",
  "get_product_kpis",
  "get_stack_status",
];

export const JOURNEY = [
  {
    id: "report",
    title: "Listen reports the play",
    body: "One event when you press play and one when it starts, fails or is cancelled, plus startup time and every stall. Listen keeps at most 96 events for ten minutes and sends them in batches of 12.",
    tag: "Listen · web, Android, iOS, desktop",
  },
  {
    id: "count",
    title: "The server counts it",
    body: "Each event is checked against a fixed schema, dropped if the server already accepted it in the last 24 hours, and limited to 120 a minute per session. Readings are kept per minute in PostgreSQL for eight days, with any gap in collection recorded next to them. Radio, Music Paths and early skips go into the same history.",
    tag: "API · PostgreSQL",
  },
  {
    id: "read",
    title: "Admin reads it",
    body: "System Health shows start success, stall time and startup over the last 15 minutes, and hides the ratios until 20 plays have been attempted. Product keeps daily figures and hides any group of fewer than three listeners.",
    tag: "Admin · no monitoring stack needed",
  },
  {
    id: "keep",
    title: "Prometheus keeps the long view",
    body: "With the optional monitoring stack, recording rules turn the readings into rates and percentiles, each next to the sample it came from. Grafana draws them on the server's loopback.",
    tag: "Opt-in",
  },
  {
    id: "alert",
    title: "Telegram gets the alert",
    body: "Crate Operator reads the rules directly, so an alert still arrives when the API is down. New rules ship switched off, and an empty or stale answer never opens or closes an incident. Agents read the same figures, read only, through the Crate MCP.",
    tag: "Opt-in · Crate Operator",
  },
];

export const REJECTED = {
  request: "POST /api/playback/qoe",
  body: '{ "event": "startup", "track_id": "…" }',
  status: "422",
  reason: "extra fields are rejected",
  aria: "A playback event with an extra track_id field is rejected by the server with status 422.",
};

export const FIGURES: ScaleFigure[] = [
  { value: 83, label: "Metric families in Prometheus" },
  { value: 32, label: "Recording rules" },
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

export const GUIDE = {
  href: `${DOCS}/operations/observability`,
  label: "Read the observability guide",
};
