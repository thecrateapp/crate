import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repoFile } from "../../lib/source-drift";
import { admin } from "./en";
import { FEATURES, FIGURES, NEVER, STACK_MAP } from "./observability";

const branchSource = (path: string) =>
  existsSync(repoFile(path)) ? readFileSync(repoFile(path), "utf8") : null;

const featureText = FEATURES.map((f) => `${f.title} ${f.body}`).join(" ");

describe("the observability chapter", () => {
  it("sits before MCP, anchored at #observability, and Operations links to it", () => {
    const ids = admin.chapters.map((chapter) => chapter.id);
    expect(ids.indexOf("observability")).toBe(ids.indexOf("mcp") - 1);
    const system = admin.chapters
      .flatMap((chapter) => chapter.features ?? [])
      .find((feature) => feature.title === "System");
    expect(system?.link?.href).toBe("#observability");
  });

  it("uses no emoji", () => {
    const text = JSON.stringify({ admin, FEATURES, NEVER, STACK_MAP });
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
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
  const component = readFileSync(
    repoFile("app/web/src/components/viz/StackMap.astro"),
    "utf8",
  );
  const view = readFileSync(
    repoFile("app/web/src/scripts/viz/stack-map-view.ts"),
    "utf8",
  );

  it("labels every capture as sample data, visibly and in the caption", () => {
    expect(STACK_MAP.sample).toBe("Sample data");
    expect(STACK_MAP.caption).toMatch(/captured with sample data/);
    expect(component).toMatch(
      /<p class="viz-label sample">\{STACK_MAP\.sample\}<\/p>/,
    );
    expect(component).not.toMatch(/class="badge"/);
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

  it("keeps the still image under reduced motion", () => {
    expect(component).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.shot video \{\s*display: none;/,
    );
    expect(view).toMatch(/if \(!video \|\| reducedMotion\(\)\) return;/);
  });

  it("captures every service Admin declares", () => {
    const topology = branchSource(
      "app/ui/src/components/admin/stack-map-topology.ts",
    );
    const capture = branchSource("tests/site-capture/stack-map.spec.ts");
    if (!topology || !capture) return;
    const declared = [
      ...topology.matchAll(/^\s+"?([a-z0-9-]+)"?: \{\n\s+label: "/gm),
    ].map(([, id]) => id!);
    expect(declared.length).toBeGreaterThan(20);
    for (const service of declared)
      expect(capture, service).toContain(`["${service}", `);
  });
});

describe("figures and thresholds from the code", () => {
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

  it("states the sample and skip thresholds the server applies", () => {
    const qoe = branchSource("app/crate/observability/playback_qoe.py");
    const kpis = branchSource("app/crate/db/queries/product_kpis.py");
    const policy = branchSource("app/crate/recommendation_policy.py");
    if (!qoe || !kpis || !policy) return;
    expect(qoe).toMatch(/^MINIMUM_ATTEMPTS = 20$/m);
    expect(qoe).toMatch(/^WINDOW_MINUTES = 15$/m);
    expect(featureText).toMatch(/until 20 plays/);
    expect(featureText).toMatch(/last 15 minutes/);
    expect(kpis).toMatch(/^MINIMUM_SEGMENT_SAMPLE = 3$/m);
    expect(featureText).toMatch(/fewer than three listeners/);
    expect(policy).toMatch(/^EARLY_SKIP_SECONDS = 30(\.0)?$/m);
    expect(featureText).toMatch(/first 30 seconds/);
  });

  it("names MCP tools the server registers", () => {
    const tools = branchSource("app/crate/mcp/tools.py");
    if (!tools) return;
    for (const tool of featureText.match(/get_[a-z_]+/g) ?? [])
      expect(tools).toContain(`"${tool}": (`);
  });

  it("keeps telemetry free of catalogue identifiers", () => {
    const schema = branchSource("app/crate/api/schemas/playback_telemetry.py");
    if (!schema) return;
    expect(schema).not.toMatch(/track_id|album_id|artist_id/);
    expect(schema).toMatch(/extra="forbid"/);
    expect(NEVER).toContain("Track, album or artist IDs");
  });
});
