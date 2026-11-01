import { describe, expect, it } from "vitest";
import {
  getServiceRelations,
  layoutStackMap,
  summarizeStack,
  type StackMapSnapshot,
} from "./stack-map-model";

function snapshot(): StackMapSnapshot {
  return {
    host: {
      id: "host",
      name: "Crate host",
      address: "192.0.2.1",
      cpuPercent: 25,
      memoryUsedGiB: 8,
      memoryTotalGiB: 32,
    },
    stacks: [
      { id: "app", name: "Crate", kind: "application", revision: "abc123" },
      {
        id: "obs",
        name: "Observability",
        kind: "observability",
        revision: "def456",
      },
    ],
    services: [
      ["crate-api", "app", "API"],
      ["readplane", "app", "Read plane"],
      ["postgres", "app", "PostgreSQL"],
      ["redis", "app", "Redis"],
      ["prometheus", "obs", "Prometheus"],
      ["grafana", "obs", "Grafana"],
    ].map(([id, stackId, label]) => ({
      id: id!,
      stackId: stackId!,
      label: label!,
      description: `${label} service`,
      runtimeState: "running",
      health: "healthy",
      cpuPercent: 1,
      memoryMiB: 128,
    })),
    connections: [
      { source: "readplane", target: "crate-api", kind: "request" },
      { source: "crate-api", target: "postgres", kind: "data" },
      { source: "crate-api", target: "redis", kind: "queue" },
      { source: "prometheus", target: "crate-api", kind: "telemetry" },
      { source: "grafana", target: "prometheus", kind: "request" },
    ],
    availability: "available",
    observedAt: "2026-10-31T12:00:00Z",
    metricsSource: "prometheus",
  };
}

describe("getServiceRelations", () => {
  it("returns incoming and outgoing direct dependencies across stack boundaries", () => {
    const relations = getServiceRelations(snapshot(), "crate-api");

    expect(relations.incoming.map((service) => service.id)).toEqual([
      "readplane",
      "prometheus",
    ]);
    expect(relations.outgoing.map((service) => service.id)).toEqual([
      "postgres",
      "redis",
    ]);
    expect(relations.activeIds).toEqual(
      new Set(["crate-api", "readplane", "postgres", "redis", "prometheus"]),
    );
    expect(relations.connections).toHaveLength(4);
    expect(relations.activeIds.has("grafana")).toBe(false);
  });

  it("ignores dangling edges instead of inventing missing services", () => {
    const data = snapshot();
    data.connections.push(
      { source: "crate-api", target: "missing", kind: "request" },
      { source: "missing", target: "crate-api", kind: "telemetry" },
    );

    const relations = getServiceRelations(data, "crate-api");

    expect(relations.connections).toHaveLength(4);
    expect(relations.activeIds.has("missing")).toBe(false);
    expect(relations.incoming.every(Boolean)).toBe(true);
    expect(relations.outgoing.every(Boolean)).toBe(true);
  });

  it("deduplicates related services when several connection types join the same pair", () => {
    const data = snapshot();
    data.connections.push(
      { source: "crate-api", target: "postgres", kind: "request" },
      { source: "prometheus", target: "crate-api", kind: "request" },
    );

    const relations = getServiceRelations(data, "crate-api");

    expect(relations.incoming.map((service) => service.id)).toEqual([
      "readplane",
      "prometheus",
    ]);
    expect(relations.outgoing.map((service) => service.id)).toEqual([
      "postgres",
      "redis",
    ]);
    expect(
      relations.outgoingLinks.map(({ service, kinds }) => [service.id, kinds]),
    ).toEqual([
      ["postgres", ["data", "request"]],
      ["redis", ["queue"]],
    ]);
    expect(
      relations.incomingLinks.map(({ service, kinds }) => [service.id, kinds]),
    ).toEqual([
      ["readplane", ["request"]],
      ["prometheus", ["telemetry", "request"]],
    ]);
  });

  it("returns no relationships for an unknown service", () => {
    expect(getServiceRelations(snapshot(), "missing")).toEqual({
      incoming: [],
      outgoing: [],
      incomingLinks: [],
      outgoingLinks: [],
      connections: [],
      activeIds: new Set(),
    });
  });

  it("does not change the supplied snapshot", () => {
    const data = snapshot();
    const original = structuredClone(data);

    getServiceRelations(data, "crate-api");

    expect(data).toEqual(original);
  });
});

function tieredSnapshot(): StackMapSnapshot {
  const data = snapshot();
  data.stacks[0]!.hubId = "crate-api";
  data.stacks[1]!.hubId = "prometheus";
  const extra = [
    ["edge", "app", "Edge", "entry"],
    ["worker", "app", "Worker", "service"],
    ["analysis", "app", "Analysis", "service"],
    ["media", "app", "Media", "service"],
  ] as const;
  for (const [id, stackId, label, tier] of extra)
    data.services.push({
      id,
      stackId,
      label,
      description: `${label} service`,
      runtimeState: "running",
      health: "healthy",
      cpuPercent: 1,
      memoryMiB: 1,
      tier,
    });
  for (const service of data.services)
    if (service.id === "postgres" || service.id === "redis")
      service.tier = "data";
  data.connections.push(
    { source: "edge", target: "readplane", kind: "request" },
    { source: "worker", target: "redis", kind: "queue" },
    { source: "analysis", target: "postgres", kind: "data" },
  );
  return data;
}

describe("layoutStackMap", () => {
  it.each([false, true])(
    "keeps positions and keyboard order stable when inventory is reordered (compact=%s)",
    (compact) => {
      const data = tieredSnapshot();
      const original = layoutStackMap(data, compact);
      const reordered = layoutStackMap(
        {
          ...data,
          stacks: [...data.stacks].reverse(),
          services: [...data.services].reverse(),
          connections: [...data.connections].reverse(),
        },
        compact,
      );

      expect(reordered.fields).toEqual(original.fields);
      expect(reordered.nodes).toEqual(original.nodes);
    },
  );

  it("chooses the same fallback hub without declared hubs or service ordering", () => {
    const data = snapshot();
    const original = layoutStackMap(data, false);
    const reordered = layoutStackMap(
      { ...data, services: [...data.services].reverse() },
      false,
    );
    expect(reordered.nodes).toEqual(original.nodes);
  });

  it("uses supplied service order before stable id ties without moving entry services out of their tier", () => {
    const data = tieredSnapshot();
    for (const service of data.services)
      Object.assign(service, { order: service.id === "worker" ? 0 : 10 });
    const original = layoutStackMap(data, false);
    const reordered = layoutStackMap(
      { ...data, services: [...data.services].reverse() },
      false,
    );
    expect(reordered.nodes).toEqual(original.nodes);
    expect(original.fields[0]!.order.slice(0, 3)).toEqual([
      "crate-api",
      "edge",
      "worker",
    ]);
  });

  it("places the hub at the centre, data stores on an inner ring and entry services at the top", () => {
    const layout = layoutStackMap(tieredSnapshot(), false);
    const app = layout.fields.find((field) => field.id === "app")!;
    const hub = layout.nodes.get("crate-api")!;
    const postgres = layout.nodes.get("postgres")!;
    const edge = layout.nodes.get("edge")!;

    expect(hub).toMatchObject({ x: app.cx, y: app.cy, ring: "hub" });
    expect(postgres.ring).toBe("inner");
    expect(postgres.radius).toBe(app.innerRadius);
    expect(edge.ring).toBe("outer");
    expect(edge.radius).toBe(app.outerRadius);
    expect(edge.x).toBeCloseTo(app.cx, 6);
    expect(edge.y).toBeLessThan(app.cy);
    expect(app.order[0]).toBe("crate-api");
    expect(app.order[1]).toBe("edge");
  });

  it("moves each data store toward the services that use it", () => {
    const layout = layoutStackMap(tieredSnapshot(), false);
    const angleBetween = (a: number, b: number) =>
      Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    const redis = layout.nodes.get("redis")!;
    const worker = layout.nodes.get("worker")!;
    const postgres = layout.nodes.get("postgres")!;
    const analysis = layout.nodes.get("analysis")!;

    expect(angleBetween(redis.angle, worker.angle)).toBeLessThan(
      angleBetween(redis.angle, analysis.angle),
    );
    expect(angleBetween(postgres.angle, analysis.angle)).toBeLessThan(
      angleBetween(postgres.angle, worker.angle),
    );
  });

  it("keeps a single ring when no data tier is declared and never stacks two services", () => {
    for (const compact of [false, true]) {
      const layout = layoutStackMap(snapshot(), compact);
      const points = [...layout.nodes.values()];
      expect(layout.fields.every((field) => field.innerRadius === null)).toBe(
        true,
      );
      const keys = new Set(
        points.map((point) => `${point.x.toFixed(1)}:${point.y.toFixed(1)}`),
      );
      expect(keys.size).toBe(points.length);
    }
  });

  it("places every compact label above or below its node so labels never run off the sides", () => {
    const layout = layoutStackMap(tieredSnapshot(), true);
    for (const point of layout.nodes.values())
      expect(["above", "below"]).toContain(point.label);
  });
});

describe("summarizeStack", () => {
  it("counts running, passing and failing services in an observed snapshot", () => {
    const data = snapshot();
    data.services[2]!.health = "unhealthy";
    data.services[3]!.runtimeState = "stopped";

    expect(summarizeStack(data, "app")).toEqual({
      total: 4,
      observed: true,
      running: 3,
      passing: 2,
      failing: 1,
      unknown: 1,
    });
  });

  it("never certifies health from a stale or unavailable snapshot", () => {
    for (const availability of ["stale", "unavailable"] as const) {
      const data = { ...snapshot(), availability };
      expect(summarizeStack(data, "app")).toEqual({
        total: 4,
        observed: false,
        running: 0,
        passing: 0,
        failing: 0,
        unknown: 4,
      });
    }
  });
});
