import {
  layoutStackMap,
  orderStackMapInventory,
  type StackMapConnection,
  type StackMapField,
  type StackMapPoint,
  type StackMapService,
  type StackMapSnapshot,
} from "../stack-map-model";
import type { StackActivityPulse } from "../stack-map-activity";

export type Vec3 = [number, number, number];

export interface Dome3D {
  id: string;
  name: string;
  kind: StackMapField["kind"];
  center: Vec3;
  radius: number;
  order: string[];
}

export interface Node3D {
  service: StackMapService;
  position: Vec3;
  direction: Vec3;
  normal: Vec3;
  domeId: string;
  ring: StackMapPoint["ring"];
  size: number;
  load: number | null;
}

export interface Edge3D {
  connection: StackMapConnection;
  points: Vec3[];
  lengths: number[];
  total: number;
  crossStack: boolean;
  arrowAt: number;
}

export interface Polyline3D {
  domeId: string;
  kind: "parallel" | "meridian" | "ground" | "tick";
  points: Vec3[];
}

export interface Beam3D {
  serviceId: string;
  edge: Edge3D;
}

export interface Scene3D {
  domes: Dome3D[];
  nodes: Map<string, Node3D>;
  edges: Edge3D[];
  beams: Beam3D[];
  lines: Polyline3D[];
  bounds: { min: Vec3; max: Vec3; center: Vec3 };
}

const UNIT = 100;
const DOME_MARGIN = 1.08;
const SURFACE_LIFT = 1.015;
const EDGE_SAMPLES = 40;
export const DOME_HEIGHT = 0.6;
export const DEFAULT_POLAR = (42 * Math.PI) / 180;
export const MAX_POLAR = (68 * Math.PI) / 180;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a: Vec3): Vec3 => {
  const l = length(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function surfaceNormal(point: Vec3, center: Vec3): Vec3 {
  return normalize([
    point[0] - center[0],
    (point[1] - center[1]) / DOME_HEIGHT ** 2,
    point[2] - center[2],
  ]);
}

function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const cosine = Math.max(-1, Math.min(1, dot(a, b)));
  const angle = Math.acos(cosine);
  if (angle < 1e-4) return normalize(add(scale(a, 1 - t), scale(b, t)));
  const s = Math.sin(angle);
  return add(
    scale(a, Math.sin((1 - t) * angle) / s),
    scale(b, Math.sin(t * angle) / s),
  );
}

function cubic(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const u = 1 - t;
  return add(
    add(scale(p0, u * u * u), scale(p1, 3 * u * u * t)),
    add(scale(p2, 3 * u * t * t), scale(p3, t * t * t)),
  );
}

function makeEdge(
  connection: StackMapConnection,
  points: Vec3[],
  crossStack: boolean,
  targetSize: number,
): Edge3D {
  const lengths = [0];
  for (let index = 1; index < points.length; index++)
    lengths.push(
      lengths[index - 1]! + length(sub(points[index]!, points[index - 1]!)),
    );
  const total = lengths[lengths.length - 1]!;
  return {
    connection,
    points,
    lengths,
    total,
    crossStack,
    arrowAt: Math.max(0.5, 1 - (targetSize + 0.07) / Math.max(total, 1e-3)),
  };
}

function circle(center: Vec3, radius: number, segments: number): Vec3[] {
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = (index / segments) * Math.PI * 2;
    return [
      center[0] + Math.cos(angle) * radius,
      center[1],
      center[2] + Math.sin(angle) * radius,
    ] as Vec3;
  });
}

export function pointAlong(edge: Edge3D, t: number): Vec3 {
  const target = Math.max(0, Math.min(1, t)) * edge.total;
  let low = 0;
  let high = edge.lengths.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (edge.lengths[middle]! < target) low = middle;
    else high = middle;
  }
  const span = edge.lengths[high]! - edge.lengths[low]! || 1;
  const k = (target - edge.lengths[low]!) / span;
  const a = edge.points[low]!;
  const b = edge.points[high]!;
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
}

export function buildScene3D(snapshot: StackMapSnapshot): Scene3D {
  const layout = layoutStackMap(snapshot, false);
  const inventory = orderStackMapInventory(snapshot);
  const servicesById = new Map(
    inventory.services.map((service) => [service.id, service]),
  );
  const finite = (values: (number | null)[]) =>
    values.filter((value): value is number => value !== null && value > 0);
  const maxMemory = Math.max(
    1,
    ...finite(snapshot.services.map((service) => service.memoryMiB)),
  );
  const maxCpu = Math.max(
    1,
    ...finite(snapshot.services.map((service) => service.cpuPercent)),
  );
  const originX = layout.width / 2;
  const originZ = layout.height / 2;
  const domes: Dome3D[] = layout.fields.map((field) => ({
    id: field.id,
    name: field.name,
    kind: field.kind,
    center: [(field.cx - originX) / UNIT, 0, (field.cy - originZ) / UNIT],
    radius: (field.outerRadius * DOME_MARGIN) / UNIT,
    order: field.order,
  }));
  const domesById = new Map(domes.map((dome) => [dome.id, dome]));

  const nodes = new Map<string, Node3D>();
  for (const [id, point] of layout.nodes) {
    const service = servicesById.get(id);
    const dome = domesById.get(point.stackId);
    if (!service || !dome) continue;
    const r = point.radius / UNIT;
    const height = Math.sqrt(Math.max(0, dome.radius ** 2 - r ** 2));
    const position: Vec3 = [
      (point.x - originX) / UNIT,
      height * DOME_HEIGHT,
      (point.y - originZ) / UNIT,
    ];
    const local = sub(position, dome.center);
    const hub = point.ring === "hub";
    nodes.set(id, {
      service,
      position,
      direction: normalize([local[0], local[1] / DOME_HEIGHT, local[2]]),
      normal: surfaceNormal(position, dome.center),
      domeId: dome.id,
      ring: point.ring,
      size:
        (hub ? 0.075 : 0.045) +
        (service.memoryMiB !== null
          ? 0.05 * Math.sqrt(Math.max(0, service.memoryMiB) / maxMemory)
          : 0),
      load:
        service.cpuPercent !== null
          ? Math.min(1, Math.sqrt(Math.max(0, service.cpuPercent) / maxCpu))
          : null,
    });
  }

  const edges: Edge3D[] = [];
  for (const connection of snapshot.connections) {
    const from = nodes.get(connection.source);
    const to = nodes.get(connection.target);
    if (!from || !to) continue;
    const crossStack = from.domeId !== to.domeId;
    let points: Vec3[];
    if (!crossStack) {
      const dome = domesById.get(from.domeId)!;
      const radius = dome.radius * SURFACE_LIFT;
      points = Array.from({ length: EDGE_SAMPLES + 1 }, (_, index) => {
        const d = slerp(from.direction, to.direction, index / EDGE_SAMPLES);
        return add(dome.center, [
          d[0] * radius,
          d[1] * radius * DOME_HEIGHT,
          d[2] * radius,
        ]);
      });
    } else {
      const lift: Vec3 = [0, length(sub(to.position, from.position)) * 0.3, 0];
      const c1 = add(from.position, lift);
      const c2 = add(to.position, lift);
      points = Array.from({ length: EDGE_SAMPLES + 1 }, (_, index) =>
        cubic(from.position, c1, c2, to.position, index / EDGE_SAMPLES),
      );
    }
    edges.push(makeEdge(connection, points, crossStack, to.size));
  }

  const beams: Beam3D[] = [];
  for (const node of nodes.values()) {
    if (!node.service.activity?.measures?.includes("ingress")) continue;
    const top = add(node.position, add(scale(node.normal, 0.55), [0, 0.35, 0]));
    beams.push({
      serviceId: node.service.id,
      edge: makeEdge(
        { source: "internet", target: node.service.id, kind: "request" },
        Array.from({ length: 17 }, (_, index) => {
          const t = index / 16;
          return add(scale(top, 1 - t), scale(node.position, t));
        }),
        false,
        node.size,
      ),
    });
  }

  const lines: Polyline3D[] = [];
  for (const dome of domes) {
    const [cx, , cz] = dome.center;
    const R = dome.radius;
    for (const latitude of [0, 20, 40, 60, 75]) {
      const phi = (latitude * Math.PI) / 180;
      lines.push({
        domeId: dome.id,
        kind: "parallel",
        points: circle(
          [cx, R * Math.sin(phi) * DOME_HEIGHT, cz],
          R * Math.cos(phi),
          72,
        ),
      });
    }
    for (let meridian = 0; meridian < 12; meridian++) {
      const angle = (meridian / 12) * Math.PI * 2;
      lines.push({
        domeId: dome.id,
        kind: "meridian",
        points: Array.from({ length: 25 }, (_, index) => {
          const phi = (index / 24) * (Math.PI / 2);
          return [
            cx + Math.cos(angle) * Math.cos(phi) * R,
            Math.sin(phi) * R * DOME_HEIGHT,
            cz + Math.sin(angle) * Math.cos(phi) * R,
          ] as Vec3;
        }),
      });
    }
    const groundRadius = R + 0.24;
    lines.push({
      domeId: dome.id,
      kind: "ground",
      points: circle([cx, 0, cz], groundRadius, 96),
    });
    for (let tick = 0; tick < 48; tick++) {
      const angle = (tick / 48) * Math.PI * 2;
      const extent = tick % 4 === 0 ? 0.08 : 0.035;
      const at = (radius: number): Vec3 => [
        cx + Math.cos(angle) * radius,
        0,
        cz + Math.sin(angle) * radius,
      ];
      lines.push({
        domeId: dome.id,
        kind: "tick",
        points: [at(groundRadius), at(groundRadius + extent)],
      });
    }
  }

  const min: Vec3 = [Infinity, 0, Infinity];
  const max: Vec3 = [-Infinity, 0, -Infinity];
  for (const dome of domes) {
    min[0] = Math.min(min[0], dome.center[0] - dome.radius - 0.3);
    min[2] = Math.min(min[2], dome.center[2] - dome.radius - 0.3);
    max[0] = Math.max(max[0], dome.center[0] + dome.radius + 0.3);
    max[2] = Math.max(max[2], dome.center[2] + dome.radius + 0.3);
    max[1] = Math.max(max[1], dome.radius * DOME_HEIGHT);
  }
  return {
    domes,
    nodes,
    edges,
    beams,
    lines,
    bounds: {
      min,
      max,
      center: [(min[0] + max[0]) / 2, max[1] * 0.15, (min[2] + max[2]) / 2],
    },
  };
}

export const PULSE_DURATION_MS = 1200;

export interface ScheduledDot {
  edge: Edge3D;
  delay: number;
  reverse: boolean;
  error: boolean;
  duration: number;
  beam: boolean;
}

export function particlesFor(count: number, dots: number) {
  return Math.min(9, Math.max(dots, Math.ceil(Math.log2(1 + count) * 1.4)));
}

export function schedulePulses(
  scene: Scene3D,
  pulses: StackActivityPulse[],
): ScheduledDot[] {
  const byConnection = new Map(
    scene.edges.map((edge) => [edge.connection, edge]),
  );
  const dots: ScheduledDot[] = [];
  pulses.forEach((pulse, edgeIndex) => {
    const edge = byConnection.get(pulse.connection);
    if (!edge) return;
    const total = particlesFor(pulse.count, pulse.dots);
    const errorDots = pulse.errors
      ? Math.max(1, Math.round((pulse.errors / pulse.count) * total))
      : 0;
    for (let index = 0; index < total; index++)
      dots.push({
        edge,
        delay: index * 150 + (edgeIndex % 6) * 90,
        reverse: pulse.reverse,
        error: index < errorDots,
        duration: PULSE_DURATION_MS,
        beam: false,
      });
  });
  return dots;
}

export function scheduleBeams(
  scene: Scene3D,
  rates: Map<string, number>,
): ScheduledDot[] {
  const dots: ScheduledDot[] = [];
  for (const beam of scene.beams) {
    const rate = rates.get(beam.serviceId) ?? 0;
    if (rate <= 0) continue;
    const total = Math.min(10, Math.ceil(Math.log2(1 + rate) * 1.3));
    for (let index = 0; index < total; index++)
      dots.push({
        edge: beam.edge,
        delay: index * 120,
        reverse: false,
        error: false,
        duration: 700,
        beam: true,
      });
  }
  return dots;
}

export const easePulse = (value: number) => value * value * (3 - 2 * value);

export function dotState(dot: ScheduledDot, elapsed: number) {
  const progress = (elapsed - dot.delay) / dot.duration;
  if (progress < 0) return { running: true, visible: false } as const;
  if (progress >= 1) return { running: false, visible: false } as const;
  const travelled = easePulse(dot.reverse ? 1 - progress : progress);
  return {
    running: true,
    visible: true,
    travelled,
    position: pointAlong(dot.edge, travelled),
    opacity: Math.min(1, progress * 6, (1 - progress) * 6),
  } as const;
}

export const GAUGE_MIN = 0.05;
export const GAUGE_RANGE = 0.4;

export function gaugeTip(node: Node3D): Vec3 | null {
  if (node.load === null || node.ring === "hub") return null;
  const reach = node.size + 0.012 + GAUGE_MIN + GAUGE_RANGE * node.load;
  return add(node.position, scale(node.normal, reach));
}
