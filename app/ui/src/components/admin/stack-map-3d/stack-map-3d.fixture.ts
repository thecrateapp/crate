import type { StackMapSnapshot } from "../stack-map-model";

export function snapshot(): StackMapSnapshot {
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
      {
        id: "app",
        name: "Crate",
        kind: "application",
        revision: "abc123",
        hubId: "crate-api",
      },
      {
        id: "obs",
        name: "Observability",
        kind: "observability",
        revision: "def456",
        hubId: "prometheus",
      },
    ],
    services: [
      ["crate-api", "app", "API", 4, 600],
      ["traefik", "app", "Edge", 1, 64],
      ["readplane", "app", "Read plane", 2, 120],
      ["postgres", "app", "PostgreSQL", 0, 2048],
      ["redis", "app", "Redis", null, null],
      ["prometheus", "obs", "Prometheus", 3, 900],
      ["grafana", "obs", "Grafana", 1, 200],
    ].map(([id, stackId, label, cpu, memory], order) => ({
      id: id as string,
      stackId: stackId as string,
      label: label as string,
      description: `${label} service`,
      runtimeState: "running" as const,
      health: "healthy" as const,
      cpuPercent: cpu as number | null,
      memoryMiB: memory as number | null,
      order,
      tier:
        id === "postgres" || id === "redis"
          ? ("data" as const)
          : id === "traefik"
            ? ("entry" as const)
            : ("service" as const),
      activity:
        id === "traefik" ? { measures: ["ingress" as const] } : undefined,
    })),
    connections: [
      { source: "traefik", target: "crate-api", kind: "request" },
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
