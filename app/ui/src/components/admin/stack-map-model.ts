export type StackMapTier = "entry" | "service" | "data";

export interface StackMapService {
  id: string;
  stackId: string;
  label: string;
  description: string;
  runtimeState: "running" | "stopped" | "restarting" | "unknown";
  health: "healthy" | "unhealthy" | "unknown";
  cpuPercent: number | null;
  memoryMiB: number | null;
  tier?: StackMapTier;
  order?: number;
}

export interface StackMapConnection {
  source: string;
  target: string;
  kind: "request" | "data" | "queue" | "telemetry";
}

export interface StackMapSnapshot {
  host: {
    id: string;
    name: string;
    address: string;
    cpuPercent: number | null;
    memoryUsedGiB: number | null;
    memoryTotalGiB: number | null;
  };
  stacks: {
    id: string;
    name: string;
    kind: "application" | "observability";
    revision: string;
    hubId?: string;
  }[];
  services: StackMapService[];
  connections: StackMapConnection[];
  availability: "available" | "stale" | "unavailable";
  observedAt: string | null;
  metricsSource: "prometheus" | null;
}

export interface StackMapLink {
  service: StackMapService;
  kinds: StackMapConnection["kind"][];
}

function compareIds(first: string, second: string) {
  return first < second ? -1 : first > second ? 1 : 0;
}

function compareServices(first: StackMapService, second: StackMapService) {
  const firstOrder = Number.isFinite(first.order)
    ? first.order!
    : Number.MAX_SAFE_INTEGER;
  const secondOrder = Number.isFinite(second.order)
    ? second.order!
    : Number.MAX_SAFE_INTEGER;
  return firstOrder - secondOrder || compareIds(first.id, second.id);
}

export function orderStackMapInventory(snapshot: StackMapSnapshot) {
  const stacks = [...snapshot.stacks].sort(
    (first, second) =>
      Number(first.kind !== "application") -
        Number(second.kind !== "application") ||
      compareIds(first.id, second.id),
  );
  const stackOrder = new Map(stacks.map((stack, index) => [stack.id, index]));
  const services = [...snapshot.services].sort(
    (first, second) =>
      (stackOrder.get(first.stackId) ?? stacks.length) -
        (stackOrder.get(second.stackId) ?? stacks.length) ||
      compareServices(first, second),
  );
  return { stacks, services };
}

export function getServiceRelations(
  snapshot: StackMapSnapshot,
  serviceId: string,
) {
  const services = new Map(
    snapshot.services.map((service) => [service.id, service]),
  );
  if (!services.has(serviceId))
    return {
      incoming: [],
      outgoing: [],
      incomingLinks: [],
      outgoingLinks: [],
      connections: [],
      activeIds: new Set<string>(),
    };
  const connections = snapshot.connections.filter(
    (connection) =>
      services.has(connection.source) &&
      services.has(connection.target) &&
      (connection.source === serviceId || connection.target === serviceId),
  );
  const incoming = new Map<string, StackMapLink>();
  const outgoing = new Map<string, StackMapLink>();
  const activeIds = new Set([serviceId]);
  const link = (
    links: Map<string, StackMapLink>,
    id: string,
    kind: StackMapConnection["kind"],
  ) => {
    const current = links.get(id);
    if (!current) links.set(id, { service: services.get(id)!, kinds: [kind] });
    else if (!current.kinds.includes(kind)) current.kinds.push(kind);
  };
  for (const connection of connections) {
    activeIds.add(connection.source);
    activeIds.add(connection.target);
    if (connection.target === serviceId)
      link(incoming, connection.source, connection.kind);
    if (connection.source === serviceId)
      link(outgoing, connection.target, connection.kind);
  }
  const incomingLinks = [...incoming.values()];
  const outgoingLinks = [...outgoing.values()];
  return {
    incoming: incomingLinks.map((entry) => entry.service),
    outgoing: outgoingLinks.map((entry) => entry.service),
    incomingLinks,
    outgoingLinks,
    connections,
    activeIds,
  };
}

export interface StackMapStackSummary {
  total: number;
  observed: boolean;
  running: number;
  passing: number;
  failing: number;
  unknown: number;
}

export function serviceHealth(
  snapshot: StackMapSnapshot,
  service: StackMapService,
): StackMapService["health"] {
  return snapshot.availability === "available" &&
    service.runtimeState === "running"
    ? service.health
    : "unknown";
}

export function summarizeStack(
  snapshot: StackMapSnapshot,
  stackId: string,
): StackMapStackSummary {
  const observed = snapshot.availability === "available";
  const summary = {
    total: 0,
    observed,
    running: 0,
    passing: 0,
    failing: 0,
    unknown: 0,
  };
  for (const service of snapshot.services) {
    if (service.stackId !== stackId) continue;
    summary.total += 1;
    if (observed && service.runtimeState === "running") summary.running += 1;
    const health = serviceHealth(snapshot, service);
    if (health === "healthy") summary.passing += 1;
    else if (health === "unhealthy") summary.failing += 1;
    else summary.unknown += 1;
  }
  return summary;
}

export interface StackMapPoint {
  x: number;
  y: number;
  angle: number;
  radius: number;
  stackId: string;
  ring: "hub" | "inner" | "outer";
  label: "left" | "right" | "above" | "below";
}

export interface StackMapField {
  id: string;
  name: string;
  kind: "application" | "observability";
  revision: string;
  cx: number;
  cy: number;
  outerRadius: number;
  innerRadius: number | null;
  yScale: number;
  order: string[];
}

const TAU = Math.PI * 2;
const TOP = -Math.PI / 2;
const COMPACT = {
  width: 440,
  rowHeight: 500,
  cx: 220,
  cy: 252,
  outer: 158,
  inner: 74,
  yScale: 1.34,
};

function normalize(angle: number) {
  const value = angle % TAU;
  return value < 0 ? value + TAU : value;
}

function spreadAngles(angles: number[], minimumGap: number) {
  const order = angles
    .map((angle, index) => ({ angle: normalize(angle), index }))
    .sort((a, b) => a.angle - b.angle);
  for (let pass = 0; pass < 24 && order.length > 1; pass++) {
    let moved = false;
    for (let index = 0; index < order.length; index++) {
      const current = order[index]!;
      const next = order[(index + 1) % order.length]!;
      const gap = normalize(next.angle - current.angle) || TAU;
      if (gap >= minimumGap - 1e-6) continue;
      const push = (minimumGap - gap) / 2;
      current.angle = normalize(current.angle - push);
      next.angle = normalize(next.angle + push);
      moved = true;
    }
    if (!moved) break;
  }
  const result = [...angles];
  for (const entry of order) result[entry.index] = entry.angle;
  return result;
}

function snapToGaps(angles: number[], start: number, step: number) {
  const taken = new Set<number>();
  return angles.map((angle) => {
    const slots = Array.from(
      { length: Math.round(TAU / step) },
      (_, slot) => slot,
    )
      .filter((slot) => !taken.has(slot))
      .sort((a, b) => {
        const distance = (slot: number) => {
          const gap = normalize(start + (slot + 0.5) * step - angle);
          return Math.min(gap, TAU - gap);
        };
        return distance(a) - distance(b);
      });
    const slot = slots[0];
    if (slot === undefined) return angle;
    taken.add(slot);
    return start + (slot + 0.5) * step;
  });
}

function labelSide(
  angle: number,
  compact: boolean,
  facing: -1 | 0 | 1,
): StackMapPoint["label"] {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  if (compact) return sine < 0 ? "above" : "below";
  const towardNeighbour = facing !== 0 && Math.sign(cosine) === facing;
  if (Math.abs(cosine) < 0.34 || (towardNeighbour && Math.abs(sine) < 0.45))
    return sine < 0 ? "above" : "below";
  return cosine < 0 ? "left" : "right";
}

export function layoutStackMap(snapshot: StackMapSnapshot, compact: boolean) {
  const inventory = orderStackMapInventory(snapshot);
  const width = compact ? COMPACT.width : 1000;
  const columns = compact ? 1 : 2;
  const rowHeight = compact ? COMPACT.rowHeight : 480;
  const height =
    Math.max(1, Math.ceil(snapshot.stacks.length / columns)) * rowHeight;
  const services = new Set(snapshot.services.map((service) => service.id));
  const nodes = new Map<string, StackMapPoint>();
  const connections = [...snapshot.connections].sort(
    (first, second) =>
      compareIds(first.source, second.source) ||
      compareIds(first.target, second.target) ||
      compareIds(first.kind, second.kind),
  );
  const fields: StackMapField[] = inventory.stacks.map((stack, index) => {
    const column = index % columns;
    const hasNeighbour =
      columns > 1 && (column === 0 ? index + 1 < snapshot.stacks.length : true);
    const facing: -1 | 0 | 1 = !hasNeighbour ? 0 : column === 0 ? 1 : -1;
    const cx = compact ? COMPACT.cx : 250 + column * 500;
    const cy =
      (compact ? COMPACT.cy : 246) + Math.floor(index / columns) * rowHeight;
    const yScale = compact ? COMPACT.yScale : 1;
    const members = inventory.services.filter(
      (service) => service.stackId === stack.id,
    );
    const hub =
      members.find((service) => service.id === stack.hubId) ?? members[0];
    const satellites = members.filter((service) => service !== hub);
    const data = satellites.filter((service) => service.tier === "data");
    const tiered = data.length > 0 && data.length < satellites.length;
    const outer = (
      tiered
        ? satellites.filter((service) => service.tier !== "data")
        : satellites
    ).sort(
      (a, b) =>
        Number(b.tier === "entry") - Number(a.tier === "entry") ||
        compareServices(a, b),
    );
    const inner = tiered ? data : [];
    const outerRadius = compact
      ? COMPACT.outer
      : stack.kind === "application" || outer.length > 9
        ? 178
        : 148;
    const innerRadius = tiered ? (compact ? COMPACT.inner : 94) : null;

    if (hub)
      nodes.set(hub.id, {
        x: cx,
        y: cy,
        angle: 0,
        radius: 0,
        stackId: stack.id,
        ring: "hub",
        label: compact ? "above" : "below",
      });

    const entryCount = outer.filter(
      (service) => service.tier === "entry",
    ).length;
    const step = TAU / Math.max(1, outer.length);
    const bottomOffset = compact && outer.length % 2 === 1 ? step / 2 : 0;
    const start =
      TOP - (Math.max(1, entryCount) - 1) * (step / 2) - bottomOffset;
    const outerAngles = new Map<string, number>();
    outer.forEach((service, order) => {
      const angle = start + order * step;
      outerAngles.set(service.id, angle);
      nodes.set(service.id, {
        x: cx + Math.cos(angle) * outerRadius,
        y: cy + Math.sin(angle) * outerRadius * yScale,
        angle,
        radius: outerRadius,
        stackId: stack.id,
        ring: "outer",
        label: labelSide(angle, compact, facing),
      });
    });

    if (innerRadius !== null) {
      const preferred = inner.map((service, order) => {
        let x = 0;
        let y = 0;
        for (const connection of connections) {
          const other =
            connection.source === service.id
              ? connection.target
              : connection.target === service.id
                ? connection.source
                : null;
          if (!other || !services.has(other)) continue;
          const angle = outerAngles.get(other);
          if (angle === undefined) continue;
          x += Math.cos(angle);
          y += Math.sin(angle);
        }
        return Math.hypot(x, y) < 1e-6
          ? TOP + (order / inner.length) * TAU
          : Math.atan2(y, x);
      });
      const spread = spreadAngles(
        preferred,
        Math.min(TAU / inner.length, (62 * Math.PI) / 180),
      );
      const angles = compact ? snapToGaps(spread, start, step) : spread;
      inner.forEach((service, order) => {
        const angle = angles[order]!;
        nodes.set(service.id, {
          x: cx + Math.cos(angle) * innerRadius,
          y: cy + Math.sin(angle) * innerRadius * yScale,
          angle,
          radius: innerRadius,
          stackId: stack.id,
          ring: "inner",
          label: labelSide(angle, compact, facing),
        });
      });
    }

    const clockwise = (list: StackMapService[]) =>
      [...list].sort(
        (a, b) =>
          normalize((nodes.get(a.id)?.angle ?? TOP) - TOP) -
          normalize((nodes.get(b.id)?.angle ?? TOP) - TOP),
      );
    return {
      id: stack.id,
      name: stack.name,
      kind: stack.kind,
      revision: stack.revision,
      cx,
      cy,
      outerRadius,
      innerRadius,
      yScale,
      order: [
        ...(hub ? [hub.id] : []),
        ...clockwise(outer).map((service) => service.id),
        ...clockwise(inner).map((service) => service.id),
      ],
    };
  });
  return { width, height, fields, nodes };
}
