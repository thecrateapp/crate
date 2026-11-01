import { describe, expect, it } from "vitest";
import {
  inventoryToStackMap,
  type StackInventory,
} from "./stack-map-inventory";

function service(
  project: string,
  name: string,
  overrides: Partial<StackInventory["services"][number]> = {},
): StackInventory["services"][number] {
  return {
    id: `${project}/${name}`,
    stack_id:
      name.includes("prometheus") || name.includes("exporter")
        ? "observability"
        : "application",
    service: name,
    project,
    container_id: name.padEnd(64, "0"),
    container_name: name,
    image: `ghcr.io/crate/${name}:1`,
    runtime_state: "running",
    health: "healthy",
    status: "Up 1 hour (healthy)",
    actions: [],
    ...overrides,
  };
}

function inventory(services: StackInventory["services"]): StackInventory {
  return {
    schema_version: 1,
    availability: "available",
    reason: null,
    host: { id: "crate-production", name: "Crate production" },
    stacks: [
      { id: "application", kind: "application", project: "crate" },
      {
        id: "observability",
        kind: "observability",
        project: "crate-observability",
      },
    ],
    services,
  };
}

describe("inventoryToStackMap", () => {
  it("decorates known services from the topology catalogue with scoped ids", () => {
    const map = inventoryToStackMap(
      inventory([
        service("crate", "crate-api"),
        service("crate", "crate-ui"),
        service("crate", "crate-postgres"),
        service("crate-observability", "crate-prometheus"),
      ]),
      { stale: false, observedAt: "2026-11-01T12:00:00Z" },
    );
    const api = map.services.find((item) => item.id === "crate/crate-api")!;

    expect(api).toMatchObject({
      label: "API",
      stackId: "application",
      tier: "service",
    });
    expect(api.activity).toEqual({ measures: ["requests"] });
    expect(
      map.services.find((item) => item.id === "crate/crate-postgres")!.tier,
    ).toBe("data");
    expect(map.stacks.find((stack) => stack.id === "application")!.hubId).toBe(
      "crate/crate-api",
    );
    expect(
      map.stacks.find((stack) => stack.id === "observability")!.hubId,
    ).toBe("crate-observability/crate-prometheus");
    expect(map.connections).toContainEqual({
      source: "crate/crate-ui",
      target: "crate/crate-api",
      kind: "request",
    });
    expect(map.host).toMatchObject({
      id: "crate-production",
      name: "Crate production",
    });
    expect(map.metricsSource).toBeNull();
  });

  it("keeps undeclared services under their own name", () => {
    const map = inventoryToStackMap(inventory([service("crate", "slskd")]), {
      stale: false,
      observedAt: null,
    });

    expect(map.services[0]).toMatchObject({
      id: "crate/slskd",
      label: "slskd",
      tier: "service",
    });
  });

  it("translates runtime and health without certifying unknown states", () => {
    const map = inventoryToStackMap(
      inventory([
        service("crate", "crate-api", {
          runtime_state: "exited",
          health: "unhealthy",
        }),
        service("crate", "crate-ui", { health: "starting" }),
        service("crate", "crate-listen", { health: "none" }),
        service("crate", "crate-worker", { runtime_state: "restarting" }),
      ]),
      { stale: false, observedAt: null },
    );
    const byId = new Map(map.services.map((item) => [item.id, item]));

    expect(byId.get("crate/crate-api")).toMatchObject({
      runtimeState: "stopped",
      health: "unhealthy",
    });
    expect(byId.get("crate/crate-ui")!.health).toBe("unknown");
    expect(byId.get("crate/crate-listen")!.health).toBe("unknown");
    expect(byId.get("crate/crate-worker")!.runtimeState).toBe("restarting");
    expect(map.services.every((item) => item.cpuPercent === null)).toBe(true);
  });

  it("carries stale and unavailable sources instead of a healthy empty map", () => {
    expect(
      inventoryToStackMap(inventory([service("crate", "crate-api")]), {
        stale: true,
        observedAt: null,
      }).availability,
    ).toBe("stale");
    const unavailable = inventoryToStackMap(
      {
        ...inventory([]),
        availability: "unavailable",
        reason: "docker_unavailable",
      },
      { stale: false, observedAt: null },
    );
    expect(unavailable.availability).toBe("unavailable");
    expect(
      inventoryToStackMap(null, { stale: false, observedAt: null })
        .availability,
    ).toBe("unavailable");
  });

  it("only connects services that are actually present", () => {
    const map = inventoryToStackMap(inventory([service("crate", "crate-ui")]), {
      stale: false,
      observedAt: null,
    });

    expect(map.connections).toEqual([]);
  });
});
