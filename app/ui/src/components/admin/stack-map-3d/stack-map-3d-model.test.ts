import { describe, expect, it } from "vitest";
import { layoutStackMap } from "../stack-map-model";
import type { StackActivityPulse } from "../stack-map-activity";
import {
  DOME_HEIGHT,
  GAUGE_MIN,
  buildScene3D,
  dotState,
  gaugeTip,
  particlesFor,
  pointAlong,
  scheduleBeams,
  schedulePulses,
} from "./stack-map-3d-model";
import { snapshot } from "./stack-map-3d.fixture";

describe("buildScene3D", () => {
  it("lifts the 2D layout onto the domes deterministically", () => {
    const first = buildScene3D(snapshot());
    const second = buildScene3D(snapshot());
    const layout = layoutStackMap(snapshot(), false);

    expect([...first.nodes].map(([id, node]) => [id, node.position])).toEqual(
      [...second.nodes].map(([id, node]) => [id, node.position]),
    );
    for (const [id, node] of first.nodes) {
      const point = layout.nodes.get(id)!;
      expect(node.position[0] * 100 + layout.width / 2).toBeCloseTo(point.x, 6);
      expect(node.position[2] * 100 + layout.height / 2).toBeCloseTo(
        point.y,
        6,
      );
    }
  });

  it("puts each hub at the apex and every service on its dome surface", () => {
    const scene = buildScene3D(snapshot());
    for (const node of scene.nodes.values()) {
      const dome = scene.domes.find((item) => item.id === node.domeId)!;
      const dx = node.position[0] - dome.center[0];
      const dy = node.position[1] / DOME_HEIGHT;
      const dz = node.position[2] - dome.center[2];
      expect(Math.hypot(dx, dy, dz)).toBeCloseTo(dome.radius, 6);
      if (node.ring === "hub") {
        expect(dx).toBeCloseTo(0, 6);
        expect(dz).toBeCloseTo(0, 6);
        expect(node.position[1]).toBeCloseTo(dome.radius * DOME_HEIGHT, 6);
      }
    }
  });

  it("keeps links inside a deployment on the dome and arcs links between domes", () => {
    const scene = buildScene3D(snapshot());
    const inside = scene.edges.find(
      (edge) => edge.connection.target === "postgres",
    )!;
    const dome = scene.domes.find((item) => item.id === "app")!;
    for (const point of inside.points) {
      const radius = Math.hypot(
        point[0] - dome.center[0],
        point[1] / DOME_HEIGHT,
        point[2] - dome.center[2],
      );
      expect(radius).toBeGreaterThan(dome.radius);
      expect(radius).toBeLessThan(dome.radius * 1.03);
    }
    const across = scene.edges.find((edge) => edge.crossStack)!;
    const middle = pointAlong(across, 0.5);
    expect(middle[1]).toBeGreaterThan(
      Math.max(across.points[0]![1], across.points[across.points.length - 1]![1]),
    );
    expect(across.arrowAt).toBeLessThan(1);
    expect(across.arrowAt).toBeGreaterThanOrEqual(0.5);
  });

  it("scales size with memory and separates zero CPU from a missing reading", () => {
    const scene = buildScene3D(snapshot());
    const postgres = scene.nodes.get("postgres")!;
    const readplane = scene.nodes.get("readplane")!;
    const redis = scene.nodes.get("redis")!;

    expect(postgres.size).toBeGreaterThan(readplane.size);
    expect(postgres.load).toBe(0);
    expect(redis.load).toBeNull();
    expect(gaugeTip(redis)).toBeNull();
    expect(gaugeTip(scene.nodes.get("crate-api")!)).toBeNull();
    const tip = gaugeTip(postgres)!;
    const reach = Math.hypot(
      tip[0] - postgres.position[0],
      tip[1] - postgres.position[1],
      tip[2] - postgres.position[2],
    );
    expect(reach).toBeCloseTo(postgres.size + 0.012 + GAUGE_MIN, 6);
  });

  it("adds an ingress beam only for services that measure ingress", () => {
    const scene = buildScene3D(snapshot());
    expect(scene.beams.map((beam) => beam.serviceId)).toEqual(["traefik"]);
    const beam = scene.beams[0]!.edge;
    expect(beam.points[beam.points.length - 1]).toEqual(scene.nodes.get("traefik")!.position);
    expect(beam.total).toBeLessThan(1);
  });
});

describe("pulse scheduling", () => {
  const scene = buildScene3D(snapshot());
  const connection = (target: string) =>
    snapshot().connections.find((item) => item.target === target)!;

  it("scales particles with the request count and marks errors first", () => {
    const edge = scene.edges.find(
      (item) => item.connection.target === "postgres",
    )!;
    const pulses: StackActivityPulse[] = [
      {
        connection: edge.connection,
        count: 40,
        errors: 10,
        dots: 3,
        reverse: false,
      },
    ];
    const dots = schedulePulses(scene, pulses);

    expect(dots).toHaveLength(particlesFor(40, 3));
    expect(dots.filter((dot) => dot.error)).toHaveLength(2);
    expect(dots[0]!.error).toBe(true);
    expect(dots.every((dot) => dot.edge === edge && !dot.beam)).toBe(true);
    expect(dots.map((dot) => dot.delay)).toEqual(
      [...dots.map((dot) => dot.delay)].sort((a, b) => a - b),
    );
  });

  it("ignores pulses for links the scene does not draw", () => {
    const pulses: StackActivityPulse[] = [
      {
        connection: { ...connection("postgres") },
        count: 5,
        errors: 0,
        dots: 2,
        reverse: false,
      },
    ];
    expect(schedulePulses(scene, pulses)).toEqual([]);
  });

  it("feeds the ingress beam only when the router reports traffic", () => {
    expect(scheduleBeams(scene, new Map([["traefik", 0]]))).toEqual([]);
    const dots = scheduleBeams(scene, new Map([["traefik", 120]]));
    expect(dots.length).toBeGreaterThan(0);
    expect(dots.every((dot) => dot.beam)).toBe(true);
  });

  it("moves each dot along its link, backwards when reversed, then stops", () => {
    const edge = scene.edges[0]!;
    const forward = {
      edge,
      delay: 100,
      reverse: false,
      error: false,
      duration: 1000,
      beam: false,
    };
    const backward = { ...forward, reverse: true };

    expect(dotState(forward, 50)).toEqual({ running: true, visible: false });
    const early = dotState(forward, 200);
    const late = dotState(forward, 900);
    expect(early.visible && late.visible).toBe(true);
    if (early.visible && late.visible) {
      expect(early.travelled).toBeLessThan(late.travelled);
      expect(early.opacity).toBeLessThanOrEqual(1);
    }
    const reversed = dotState(backward, 200);
    if (reversed.visible) expect(reversed.travelled).toBeGreaterThan(0.5);
    expect(dotState(forward, 1200)).toEqual({ running: false, visible: false });
  });
});
