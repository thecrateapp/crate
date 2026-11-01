import type { StackMapService, StackMapSnapshot } from "./stack-map-model";
import {
  STACK_ACTIVITY_ROLES,
  STACK_CONNECTIONS,
  STACK_HUBS,
  STACK_SERVICE_CATALOG,
} from "./stack-map-topology";

export interface StackInventory {
  schema_version: number;
  availability: "available" | "unavailable";
  reason: string | null;
  host: { id: string; name: string };
  stacks: {
    id: "application" | "observability";
    kind: "application" | "observability";
    project: string;
  }[];
  services: {
    id: string;
    stack_id: "application" | "observability";
    service: string;
    project: string;
    container_id: string;
    container_name: string;
    image: string;
    runtime_state: string;
    health: "healthy" | "unhealthy" | "starting" | "none";
    status: string;
    actions: ("restart" | "stop" | "start")[];
  }[];
}

const STACK_NAMES = {
  application: "Application",
  observability: "Observability",
} as const;

function runtimeState(state: string): StackMapService["runtimeState"] {
  if (state === "running") return "running";
  if (state === "restarting") return "restarting";
  if (["exited", "dead", "created", "paused", "removing"].includes(state))
    return "stopped";
  return "unknown";
}

function health(
  value: StackInventory["services"][number]["health"],
): StackMapService["health"] {
  return value === "healthy" || value === "unhealthy" ? value : "unknown";
}

export function inventoryToStackMap(
  inventory: StackInventory | null | undefined,
  { stale, observedAt }: { stale: boolean; observedAt: string | null },
): StackMapSnapshot {
  const available = inventory?.availability === "available";
  const entries = available ? inventory!.services : [];
  const services: StackMapService[] = entries.map((entry) => {
    const declaration = STACK_SERVICE_CATALOG[entry.service];
    return {
      id: entry.id,
      stackId: entry.stack_id,
      label: declaration?.label ?? entry.service,
      description:
        declaration?.description ?? `${entry.service} · ${entry.image}`,
      runtimeState: runtimeState(entry.runtime_state),
      health: health(entry.health),
      cpuPercent: null,
      memoryMiB: null,
      tier: declaration?.tier ?? "service",
      order: declaration?.order,
      activity: STACK_ACTIVITY_ROLES[entry.service],
    };
  });
  const idsByService = new Map<string, string>();
  for (const entry of entries) {
    const declared = STACK_SERVICE_CATALOG[entry.service]?.stack;
    if (!idsByService.has(entry.service) || declared === entry.stack_id)
      idsByService.set(entry.service, entry.id);
  }
  const connections = STACK_CONNECTIONS.flatMap(([source, target, kind]) => {
    const from = idsByService.get(source);
    const to = idsByService.get(target);
    return from && to ? [{ source: from, target: to, kind }] : [];
  });
  const stacks = (available ? inventory!.stacks : []).map((stack) => {
    const hub = idsByService.get(STACK_HUBS[stack.id]);
    const owned = entries.some(
      (entry) => entry.id === hub && entry.stack_id === stack.id,
    );
    return {
      id: stack.id,
      name: STACK_NAMES[stack.id],
      kind: stack.kind,
      revision: "—",
      hubId: owned ? hub : undefined,
    };
  });
  return {
    host: {
      id: inventory?.host.id ?? "unknown",
      name: inventory?.host.name ?? "Unknown host",
      address: inventory?.host.id ?? "",
      cpuPercent: null,
      memoryUsedGiB: null,
      memoryTotalGiB: null,
    },
    stacks,
    services,
    connections,
    availability: !available ? "unavailable" : stale ? "stale" : "available",
    observedAt,
    metricsSource: null,
  };
}
