import { describe, expect, it } from "vitest";
import {
  deriveStackActivity,
  type StackActivityFrame,
} from "./stack-map-activity";
import type { StackMapSnapshot } from "./stack-map-model";

const NOW = Date.parse("2026-11-01T12:00:05Z");

function snapshot(): StackMapSnapshot {
  const service = (
    id: string,
    activity?: StackMapSnapshot["services"][number]["activity"],
  ) => ({
    id,
    stackId: "app",
    label: id,
    description: id,
    runtimeState: "running" as const,
    health: "healthy" as const,
    cpuPercent: 1,
    memoryMiB: 1,
    activity,
  });
  return {
    host: {
      id: "h",
      name: "Host",
      address: "192.0.2.1",
      cpuPercent: 1,
      memoryUsedGiB: 1,
      memoryTotalGiB: 2,
    },
    stacks: [
      {
        id: "app",
        name: "App",
        kind: "application",
        revision: "a",
        hubId: "api",
      },
    ],
    services: [
      service("api", { measures: ["requests"] }),
      service("admin", { clients: ["admin-web"] }),
      service("readplane", { clients: ["readplane"] }),
      service("listen", {
        clients: ["listen-web"],
        measures: ["listening"],
      }),
      service("durable"),
      service("postgres"),
      service("worker", { queues: ["default", "fast"] }),
      service("fast-worker", { queues: ["fast"] }),
      service("projector", { measures: ["events"] }),
    ],
    connections: [
      { source: "admin", target: "api", kind: "request" },
      { source: "readplane", target: "api", kind: "request" },
      { source: "worker", target: "durable", kind: "queue" },
      { source: "fast-worker", target: "durable", kind: "queue" },
      { source: "projector", target: "durable", kind: "queue" },
      { source: "projector", target: "postgres", kind: "data" },
    ],
    availability: "available",
    observedAt: "2026-11-01T12:00:00Z",
    metricsSource: "prometheus",
  };
}

function frame(
  overrides: Partial<StackActivityFrame> = {},
): StackActivityFrame {
  return {
    schema: 1,
    sequence: 7,
    observed_at: "2026-11-01T12:00:03Z",
    window_seconds: 5,
    availability: "available",
    requests: {
      "admin-web": { count: 12, errors: 1 },
      readplane: { count: 1, errors: 0 },
      "listen-web": { count: 2, errors: 0 },
    },
    queues: {
      default: { completed: 3, failed: 0 },
      fast: { completed: 5, failed: 1 },
    },
    projector: { events: 4 },
    listening: 2,
    sources: {
      metrics: "available",
      playback: "available",
      projector: "available",
    },
    ...overrides,
  };
}

const pulse = (
  view: ReturnType<typeof deriveStackActivity>,
  source: string,
  target: string,
) =>
  view.pulses.find(
    (item) =>
      item.connection.source === source && item.connection.target === target,
  );

describe("deriveStackActivity", () => {
  it("reports unavailable without a frame and never invents readings", () => {
    const view = deriveStackActivity(snapshot(), null, { now: NOW });

    expect(view.status).toBe("unavailable");
    expect(view.pulses).toEqual([]);
    expect(view.summary.requestsPerMinute).toBeNull();
  });

  it("keeps a warming frame still while showing the readings it has", () => {
    const view = deriveStackActivity(
      snapshot(),
      frame({ availability: "warming", requests: null, queues: null }),
      { now: NOW },
    );

    expect(view.status).toBe("warming");
    expect(view.pulses).toEqual([]);
    expect(view.summary.requestsPerMinute).toBeNull();
    expect(view.readings.get("listen")).toContainEqual({
      label: "Listening",
      value: "2",
    });
  });

  it("pulses declared client links and totals requests on the measuring service", () => {
    const view = deriveStackActivity(snapshot(), frame(), { now: NOW });

    expect(view.status).toBe("live");
    expect(view.summary.requestsPerMinute).toBe(180);
    expect(view.readings.get("api")).toContainEqual({
      label: "Requests",
      value: "180/min",
    });
    expect(pulse(view, "admin", "api")).toMatchObject({
      count: 12,
      errors: 1,
      dots: 3,
      reverse: false,
    });
    expect(pulse(view, "readplane", "api")).toMatchObject({
      count: 1,
      dots: 1,
    });
  });

  it("does not draw a pulse for a client without a declared connection", () => {
    const view = deriveStackActivity(snapshot(), frame(), { now: NOW });

    expect(
      view.pulses.some((item) => item.connection.source === "listen"),
    ).toBe(false);
    expect(view.readings.get("listen")).toContainEqual({
      label: "Requests",
      value: "24/min",
    });
  });

  it("delivers single-consumer queues to their worker and keeps shared queues on the store", () => {
    const view = deriveStackActivity(snapshot(), frame(), { now: NOW });

    expect(pulse(view, "worker", "durable")).toMatchObject({
      count: 3,
      reverse: true,
    });
    expect(pulse(view, "fast-worker", "durable")).toBeUndefined();
    expect(view.readings.get("durable")).toContainEqual({
      label: "fast",
      value: "6 tasks · 1 failed",
    });
  });

  it("pulses projected events through the projector's queue and data links", () => {
    const view = deriveStackActivity(snapshot(), frame(), { now: NOW });

    expect(pulse(view, "projector", "durable")).toMatchObject({
      count: 4,
      reverse: true,
    });
    expect(pulse(view, "projector", "postgres")).toMatchObject({
      count: 4,
      reverse: false,
    });
  });

  it("pauses an old frame: readings stay, motion stops", () => {
    const view = deriveStackActivity(snapshot(), frame(), {
      now: Date.parse("2026-11-01T12:00:30Z"),
    });

    expect(view.status).toBe("paused");
    expect(view.pulses).toEqual([]);
    expect(view.readings.get("api")).toBeDefined();
    expect(view.ageSeconds).toBe(27);
  });

  it("caps the total number of moving dots", () => {
    const data = snapshot();
    for (let index = 0; index < 30; index++) {
      data.services.push({
        ...data.services[1]!,
        id: `client-${index}`,
        activity: { clients: [`c${index}`] },
      });
      data.connections.push({
        source: `client-${index}`,
        target: "api",
        kind: "request",
      });
    }
    const requests = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [
        `c${index}`,
        { count: 50, errors: 0 },
      ]),
    );

    const view = deriveStackActivity(data, frame({ requests }), { now: NOW });

    expect(
      view.pulses.reduce((total, item) => total + item.dots, 0),
    ).toBeLessThanOrEqual(40);
  });
});
