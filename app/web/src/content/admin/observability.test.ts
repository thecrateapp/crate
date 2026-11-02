import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { repoFile } from "../../lib/source-drift";
import { admin } from "./en";
import {
  FEATURES,
  FIGURES,
  LIVE_READINGS,
  MAP_HEADINGS,
  NEVER,
  STACKS,
} from "./observability";

const branchSource = (path: string) =>
  existsSync(repoFile(path)) ? readFileSync(repoFile(path), "utf8") : null;

const topology = branchSource(
  "app/ui/src/components/admin/stack-map-topology.ts",
);
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

  it("labels the map readings as a sample", () => {
    expect(MAP_HEADINGS.sample).toBe("Sample readings");
  });

  it("uses no emoji", () => {
    const text = JSON.stringify({ admin, FEATURES, NEVER, STACKS });
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("the stack map copied from Admin's topology", () => {
  const catalog = topology
    ? new Map(
        [
          ...topology.matchAll(
            /^\s+"?([a-z0-9-]+)"?: \{\n\s+label: "([^"]+)",[\s\S]*?stack: "(\w+)"/gm,
          ),
        ].map(([, id, label, stack]) => [
          id!,
          { label: label!, stack: stack! },
        ]),
      )
    : new Map();
  const connections = topology
    ? new Set(
        [
          ...topology.matchAll(/\["([a-z0-9-]+)", "([a-z0-9-]+)", "(\w+)"\]/g),
        ].map(([, a, b, kind]) => `${a} ${b} ${kind}`),
      )
    : new Set<string>();

  it.skipIf(!topology)(
    "names every service as Admin does, in its stack",
    () => {
      for (const stack of STACKS)
        for (const node of stack.nodes)
          expect(catalog.get(node.id), node.id).toEqual({
            label: node.label,
            stack: stack.id,
          });
    },
  );

  it.skipIf(!topology)("shows every declared service once", () => {
    const shown = STACKS.flatMap((stack) => stack.nodes.map((node) => node.id));
    expect([...shown].sort()).toEqual([...catalog.keys()].sort());
  });

  it.skipIf(!topology)("draws only connections Admin declares", () => {
    for (const stack of STACKS)
      for (const [from, to, kind] of stack.links)
        expect(connections).toContain(`${from} ${to} ${kind}`);
  });

  it.skipIf(!topology)("puts the hubs Admin uses at the centre", () => {
    const hubs = STACKS.map(
      (stack) => stack.nodes.find((node) => node.hub)?.id,
    );
    expect(hubs).toEqual(["crate-api", "crate-prometheus"]);
    expect(topology).toMatch(
      /application: "crate-api",\n\s+observability: "crate-prometheus"/,
    );
  });

  it("only lists clients the API classifies", () => {
    const data = branchSource("app/crate/observability/metric_catalog_data.py");
    if (!data) return;
    const block = data.slice(data.indexOf('"http_client": ('));
    const clients = [
      ...block.slice(0, block.indexOf(")")).matchAll(/"([a-z-]+)"/g),
    ].map(([, value]) => value);
    for (const client of LIVE_READINGS.clients)
      expect(clients).toContain(client.client);
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
