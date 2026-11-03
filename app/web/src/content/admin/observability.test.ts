import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { t } from "../../i18n";
import { repoFile } from "../../lib/source-drift";
import { admin } from "./en";
import {
  ALERT_STATES,
  CLIENTS,
  EDGE,
  FIGURES,
  FLOWS,
  GAP,
  GUIDE,
  HEADINGS,
  JOURNEY,
  LEGEND,
  MCP_TOOLS,
  NEVER,
  PLAYBACK,
  PRODUCT_CROP,
  QOE_EVENT,
  READINGS,
  REJECTED,
  RULE,
  SAMPLE,
  STACK_MAP,
  STATES,
  gapSeries,
} from "./observability";

const branchSource = (path: string) =>
  existsSync(repoFile(path)) ? readFileSync(repoFile(path), "utf8") : null;

const step = (id: string) => JOURNEY.find((item) => item.id === id)!;

const component = readFileSync(
  repoFile("app/web/src/components/viz/StackMap.astro"),
  "utf8",
);
const chapter = readFileSync(
  repoFile("app/web/src/components/admin/Observability.astro"),
  "utf8",
);
const view = readFileSync(
  repoFile("app/web/src/scripts/viz/stack-map-view.ts"),
  "utf8",
);

describe("the observability chapter", () => {
  it("sits before MCP, anchored at #observability, and Operations links to it", () => {
    const ids = admin.chapters.map((chapter) => chapter.id);
    expect(ids.indexOf("observability")).toBe(ids.indexOf("mcp") - 1);
    const system = admin.chapters
      .flatMap((chapter) => chapter.features ?? [])
      .find((feature) => feature.title === "System");
    expect(system?.link?.href).toBe("#observability");
  });

  it("opens with the Stack map, then the gap, the journey, the figures and the guide", () => {
    const order = [
      "<StackMap />",
      'class="legend"',
      "{HEADINGS.gap}",
      "{HEADINGS.journey}",
      "{NEVER_LABEL}",
      "<ScaleFigures figures",
      "href={GUIDE.href}",
    ].map((marker) => chapter.indexOf(marker));
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(HEADINGS.gap).toBe("A missing reading is never drawn as zero.");
  });

  it("links to the observability guide in the docs", () => {
    expect(GUIDE.href).toBe(
      "https://docs.cratemusic.app/operations/observability",
    );
    const doc = branchSource("docs/technical/observability.md");
    if (!doc) return;
    expect(doc).toMatch(/^section: operations$/m);
  });

  it("has a home lead that points at the chapter", () => {
    const inside = readFileSync(
      repoFile("app/web/src/components/InsideCrate.astro"),
      "utf8",
    );
    expect(inside).toContain('{ id: "stack", href: "/admin#observability" }');
    expect(t("inside.stack.title")).toBe("Your server, drawn live.");
    expect(t("inside.stack.sample")).toBe(STACK_MAP.sample);
  });

  it("uses no emoji and no long dashes", () => {
    const text = JSON.stringify({
      admin,
      JOURNEY,
      STATES,
      LEGEND,
      HEADINGS,
      NEVER,
      STACK_MAP,
      GAP,
    });
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).not.toMatch(/—/);
  });
});

const webpSize = (file: string) => {
  const bytes = readFileSync(file);
  expect(bytes.toString("ascii", 12, 16)).toBe("VP8 ");
  return {
    width: bytes.readUInt16LE(26) & 0x3fff,
    height: bytes.readUInt16LE(28) & 0x3fff,
  };
};

describe("the Stack map captures", () => {
  it("labels every capture as sample data, visibly and in the caption", () => {
    expect(STACK_MAP.sample).toBe("Sample data");
    expect(STACK_MAP.caption).toMatch(/captured with sample data/);
    expect(component).toMatch(
      /<p class="viz-label sample">\{STACK_MAP\.sample\}<\/p>/,
    );
    expect(chapter.match(/\{STACK_MAP\.sample\}/g)).toHaveLength(3);
  });

  it("ships every image width with the declared size", () => {
    const { image } = STACK_MAP;
    expect(image.alt.length).toBeGreaterThan(80);
    for (const width of STACK_MAP.widths) {
      const file = repoFile(`app/web/public${image.image}-${width}.webp`);
      expect(existsSync(file), file).toBe(true);
      const size = webpSize(file);
      expect(size.width).toBe(width);
      expect(size.height / size.width).toBeCloseTo(
        image.height / image.width,
        2,
      );
    }
  });

  it("ships a portrait crop for phones and serves it below 760 px", () => {
    const { portrait } = STACK_MAP;
    expect(webpSize(repoFile(`app/web/public${portrait.image}`))).toEqual({
      width: portrait.width,
      height: portrait.height,
    });
    expect(portrait.media).toBe("(max-width: 760px)");
    expect(component).toMatch(
      /<source media=\{portrait\.media\} srcset=\{portrait\.image\}/,
    );
    expect(component).toMatch(
      /@media \(max-width: 760px\) \{[^}]*\.shot \{[^}]*aspect-ratio: 780 \/ 897;/,
    );
  });

  it("ships the 3D loop as WebM and MP4 and loads it only on demand", () => {
    for (const format of ["webm", "mp4"])
      expect(
        existsSync(repoFile(`app/web/public${STACK_MAP.video}.${format}`)),
      ).toBe(true);
    expect(component).toMatch(
      /<video muted loop playsinline preload="none"[^>]*poster=/,
    );
    expect(component).toMatch(/loading="lazy"/);
    expect(component).toMatch(/decoding="async"/);
  });

  it("keeps the still image under reduced motion and on phones", () => {
    expect(component).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.shot video \{\s*display: none;/,
    );
    expect(view).toMatch(/if \(!video \|\| reducedMotion\(\)\) return;/);
    expect(view).toMatch(
      /if \(getComputedStyle\(video\)\.display === "none"\) return;/,
    );
  });

  it("records the loop after a warm-up and rejects a bright frame", () => {
    const capture = branchSource("tests/site-capture/stack-map.spec.ts");
    const script = branchSource("scripts/site/stack-map-assets.sh");
    if (!capture || !script) return;
    expect(capture).toMatch(
      /await page\.waitForTimeout\(WARMUP_MS\);\s*recording = true;/,
    );
    expect(script).toMatch(/^MAX_FRAME_LUMA=\$\{MAX_FRAME_LUMA:-80\}$/m);
    expect(script).toMatch(/if \(\(luma > MAX_FRAME_LUMA\)\); then/);
    expect(script.indexOf("brightest")).toBeLessThan(
      script.indexOf('cp "$RAW/stack-map-3d.webm"'),
    );
  });

  it("captures every service Admin declares", () => {
    const topology = branchSource(
      "app/ui/src/components/admin/stack-map-topology.ts",
    );
    if (!topology) return;
    const declared = [
      ...topology.matchAll(/^\s+"?([a-z0-9-]+)"?: \{\n\s+label: "/gm),
    ].map(([, id]) => id!);
    const captured = [...SAMPLE.application, ...SAMPLE.observability].map(
      (row) => row[0],
    );
    expect(declared.length).toBeGreaterThan(20);
    for (const service of declared)
      expect(captured, service).toContain(service);
  });
});

describe("the shared Stack map sample", () => {
  it("is the data the capture streams", () => {
    const capture = branchSource("tests/site-capture/stack-map.spec.ts");
    if (!capture) return;
    expect(capture).toContain(
      'import sample from "../../app/web/src/content/admin/stack-map-sample.json";',
    );
    expect(capture).not.toMatch(/\["crate-api", "crate-api"/);
    expect(capture).toMatch(/listening: activity\.listening/);
    expect(capture).toMatch(/cpu_percent: host\.cpu_percent/);
  });

  it("drives every reading on the page", () => {
    const value = (label: string) =>
      READINGS.find((reading) => reading.label === label)!;
    expect(value("Listening now").value).toBe(
      String(SAMPLE.activity.listening),
    );
    expect(value("Host CPU").value).toBe(String(SAMPLE.host.cpu_percent));
    expect(value("Host memory").value).toBe(
      SAMPLE.host.memory_used_gib.toFixed(1),
    );
    expect(value("Host memory").unit).toContain(
      String(SAMPLE.host.memory_total_gib),
    );
    expect(value("Services").value).toBe(
      String(SAMPLE.application.length + SAMPLE.observability.length),
    );
  });

  it("names clients, queues and Edge routers the sample streams", () => {
    for (const client of Object.keys(CLIENTS))
      expect(SAMPLE.activity.requests).toHaveProperty(client);
    for (const router of Object.keys(SAMPLE.activity.ingress))
      expect(EDGE).toHaveProperty(router);
    expect(FLOWS.find((flow) => flow.key === "Tasks")!.items).toEqual(
      Object.keys(SAMPLE.activity.queues),
    );
  });

  it("names the clients the Stack map counts", () => {
    const doc = branchSource("docs/technical/observability.md");
    if (!doc) return;
    expect(doc).toMatch(
      /Listen on web, Android, iOS and desktop,\s+Admin and Subsonic/,
    );
  });
});

describe("the gap chart", () => {
  it("leaves the lost minutes out instead of drawing zero", () => {
    const series = gapSeries();
    const [from, to] = GAP.gap;
    expect(series).toHaveLength(GAP.minutes);
    series.forEach((value, minute) => {
      if (minute >= from && minute <= to) expect(value).toBeNull();
      else expect(value).toBeGreaterThan(0);
    });
    expect(GAP.state).toBe("partial · source gap");
  });

  it("uses the availability states System Health reports", () => {
    const metrics = branchSource("app/crate/metrics.py");
    if (!metrics) return;
    for (const state of STATES) expect(metrics).toContain(`"${state.key}"`);
    expect(metrics).toMatch(
      /availability="partial" if gap else "available",\s+reason="source_gap" if gap/,
    );
    expect(metrics).toMatch(
      /status\[name\]\.update\(availability="stale", reason="collection_stale"\)/,
    );
    expect(metrics).toMatch(/^_PERSISTED_COLLECTION_MAX_AGE = 600$/m);
    const state = (key: string) =>
      STATES.find((item) => item.key === key)!.body;
    expect(state("stale")).toMatch(/more than ten minutes/);
    expect(state("partial")).toMatch(/gap/);
    expect(metrics).toMatch(
      /"availability": "empty",\s+"reason": "no_observations"/,
    );
  });

  it("draws a source gap as no line in Admin", () => {
    const model = branchSource(
      "app/ui/src/components/system-health/metric-stream-model.ts",
    );
    if (!model) return;
    expect(model).toMatch(/!sample\.source_gap &&/);
    expect(model).toMatch(
      /points\.push\(\{ x: previous \+ intervalSeconds \* 1000, y: null \}\)/,
    );
  });
});

describe("from a play to an alert", () => {
  it("shows an event Listen can send and the server accepts", () => {
    const schema = branchSource("app/crate/api/schemas/playback_telemetry.py");
    if (!schema) return;
    const literal = (name: string) =>
      [
        ...schema
          .match(new RegExp(`^${name} = Literal\\[([^\\]]+)\\]`, "m"))![1]!
          .matchAll(/"([a-z_0-9]+)"/g),
      ].map(([, value]) => value);
    const body = schema.slice(schema.indexOf("class PlaybackQoeEventRequest"));
    for (const field of Object.keys(QOE_EVENT))
      expect(body).toMatch(new RegExp(`^    ${field}: `, "m"));
    expect(literal("PlaybackQoeEventName")).toContain(QOE_EVENT.event);
    expect(literal("PlaybackQoeOutcome")).toContain(QOE_EVENT.outcome);
    expect(literal("PlaybackQoeOrigin")).toContain(QOE_EVENT.origin);
    expect(literal("PlaybackQoeRuntime")).toContain(QOE_EVENT.runtime);
    expect(literal("PlaybackQoeEngine")).toContain(QOE_EVENT.engine);
  });

  it("rejects a payload with an extra field", () => {
    const schema = branchSource("app/crate/api/schemas/playback_telemetry.py");
    if (!schema) return;
    expect(schema).not.toMatch(/track_id|album_id|artist_id/);
    expect(
      schema.match(/model_config = ConfigDict\(extra="forbid"\)/g)!.length,
    ).toBeGreaterThanOrEqual(3);
    expect(REJECTED.body).toContain('"track_id"');
    expect(REJECTED.status).toBe("422");
    expect(NEVER).toContain("Track, album or artist IDs");
  });

  it("states the client buffer and the server limits", () => {
    const store = branchSource("app/listen/src/lib/playback-qoe-store.ts");
    const api = branchSource("app/crate/api/playback_telemetry.py");
    if (!store || !api) return;
    expect(store).toMatch(/batchSize: 12,/);
    expect(store).toMatch(/bufferSize: 96,/);
    expect(store).toMatch(/eventTtlMs: 10 \* 60_000,/);
    expect(step("report").body).toMatch(
      /at most 96 events for ten minutes and sends them in batches of 12/,
    );
    expect(api).toMatch(/^_QOE_SESSION_MAX_EVENTS = 120$/m);
    expect(api).toMatch(/^_QOE_RATE_LIMIT_WINDOW_SECONDS = 60$/m);
    expect(api).toMatch(/^_QOE_DEDUP_SECONDS = 24 \* 60 \* 60$/m);
    expect(step("count").body).toMatch(
      /last 24 hours, and limited to 120 a minute per session/,
    );
    expect(chapter).toContain(
      "24 h duplicate window · 120 events a minute per session",
    );
  });

  it("keeps the minute history for eight days", () => {
    const minutes = branchSource("app/crate/db/queries/metric_minutes.py");
    if (!minutes) return;
    expect(minutes).toMatch(/"retention_days": 8,/);
    expect(step("count").body).toMatch(
      /per minute in PostgreSQL for eight days/,
    );
  });

  it("states the sample thresholds the server applies", () => {
    const qoe = branchSource("app/crate/observability/playback_qoe.py");
    const kpis = branchSource("app/crate/db/queries/product_kpis.py");
    if (!qoe || !kpis) return;
    expect(qoe).toMatch(
      new RegExp(`^MINIMUM_ATTEMPTS = ${PLAYBACK.minimumAttempts}$`, "m"),
    );
    expect(qoe).toMatch(/^WINDOW_MINUTES = 15$/m);
    expect(step("read").body).toMatch(
      /last 15 minutes, and hides the ratios until 20 plays/,
    );
    expect(kpis).toMatch(/^MINIMUM_SEGMENT_SAMPLE = 3$/m);
    expect(step("read").body).toMatch(/fewer than three listeners/);
    expect(PRODUCT_CROP.alt).toMatch(/Hidden, fewer than 3 listeners/);
    expect(PLAYBACK.successPercent).toBe(
      Math.round((PLAYBACK.started / PLAYBACK.attempts) * 100),
    );
  });

  it("ships the Product crop the capture takes, marked as sample data", () => {
    const capture = branchSource("tests/site-capture/product.spec.ts");
    expect(webpSize(repoFile(`app/web/public${PRODUCT_CROP.image}`))).toEqual({
      width: PRODUCT_CROP.width,
      height: PRODUCT_CROP.height,
    });
    expect(chapter).toMatch(
      /<b>\{PRODUCT_CROP\.label\}<\/b>[\s\S]{0,120}\{STACK_MAP\.sample\}/,
    );
    if (!capture) return;
    expect(capture).toContain(
      'getByRole("region", { name: "Plays by platform" })',
    );
    expect(capture).toContain(
      'series("listening.plays_by_platform", 2, { platform: "ios" }, 1)',
    );
  });

  it("names a recording rule Prometheus records and the Operator can read", () => {
    const rules = branchSource("deploy/observability/recording-rules.yml");
    const operator = branchSource("deploy/operator/prometheus.py");
    if (!rules || !operator) return;
    expect(rules).toContain(`- record: ${RULE}`);
    expect(operator).toContain(`"${RULE}"`);
    const figure = FIGURES.find(
      (item) => item.label === "Recording rules",
    )!.value;
    expect(rules.match(/^\s+- record:/gm)!.length).toBe(figure);
  });

  it("ships alert rules switched off, enabled after a shadow period", () => {
    const config = branchSource("deploy/operator/config.operator.example.json");
    const monitoring = branchSource("docs/technical/monitoring.md");
    if (!config || !monitoring) return;
    const rules = JSON.stringify(JSON.parse(config));
    const prometheusRules = [
      ...rules.matchAll(
        /\{[^{}]*"tool":"prometheus_query"[^{}]*(\{[^{}]*\}[^{}]*)?\}/g,
      ),
    ].map(([rule]) => rule);
    expect(prometheusRules.length).toBeGreaterThan(5);
    for (const rule of prometheusRules)
      expect(rule).toContain('"enabled":false');
    expect(monitoring).toMatch(/shadow for 7 to 14 days/);
    expect(ALERT_STATES.map((state) => state.label)).toContain(
      "shadow period · 7 to 14 days",
    );
    expect(step("alert").body).toMatch(/New rules ship switched off/);
  });

  it("names MCP tools the server registers", () => {
    const tools = branchSource("app/crate/mcp/tools.py");
    if (!tools) return;
    for (const tool of MCP_TOOLS) expect(tools).toContain(`"${tool}": (`);
  });
});

describe("figures from the code", () => {
  it("counts recording rules, dashboards and exported families", () => {
    const rules = branchSource("deploy/observability/recording-rules.yml");
    const reference = branchSource("docs/technical/metrics-reference.md");
    if (!rules || !reference) return;
    const figure = (label: string) =>
      FIGURES.find((item) => item.label === label)!.value;
    expect(figure("Recording rules")).toBe(
      rules.match(/^\s+- record:/gm)!.length,
    );
    expect(figure("Grafana dashboards")).toBe(
      readdirSync(repoFile("deploy/observability/grafana/dashboards")).filter(
        (name) => name.endsWith(".json"),
      ).length,
    );
    expect(reference).toMatch(
      new RegExp(`; ${figure("Metric families in Prometheus")} are exported`),
    );
  });
});
