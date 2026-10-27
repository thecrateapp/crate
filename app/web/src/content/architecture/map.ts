import type { MapEdge, Rect } from "../../lib/system-map";

export type Layout = "wide" | "tall";

export interface MapNode {
  id: string;
  name: string;
  kind: "client" | "service" | "store" | "group";
  meta?: string;
  memory?: string;
  mount?: "ro" | "rw";
  parent?: string;
  inTrace?: false;
  layout: Record<Layout, Rect>;
}

export interface MapEdgeDef extends MapEdge {
  fallback?: true;
  only?: Layout;
}

const wide = (x: number, y: number, w = 190, h = 72): Rect => ({ x, y, w, h });
const tall = (x: number, y: number, w = 165, h = 64): Rect => ({ x, y, w, h });

const worker = (
  index: number,
  id: string,
  meta: string,
  memory: string,
  mount: "ro" | "rw",
): MapNode => ({
  id,
  name: id,
  kind: "service",
  meta,
  memory,
  mount,
  parent: "workers",
  inTrace: false,
  layout: {
    wide: wide(36 + index * 196, 556, 180),
    tall: tall(
      index % 2 === 0 ? 12 : 188,
      512 + Math.floor(index / 2) * 76,
      160,
    ),
  },
});

export const nodes: MapNode[] = [
  {
    id: "listen",
    name: "Listen",
    kind: "client",
    meta: "web · desktop · Android",
    layout: { wide: wide(20, 150), tall: tall(0, 0) },
  },
  {
    id: "admin",
    name: "Admin",
    kind: "client",
    meta: "web",
    layout: { wide: wide(20, 290), tall: tall(195, 0) },
  },
  {
    id: "traefik",
    name: "traefik",
    kind: "service",
    meta: "routing · health checks",
    layout: { wide: wide(270, 220), tall: tall(0, 96) },
  },
  {
    id: "frontends",
    name: "ui · listen · cast",
    kind: "service",
    meta: "nginx · static apps",
    inTrace: false,
    layout: { wide: wide(270, 380), tall: tall(195, 96) },
  },
  {
    id: "readplane",
    name: "readplane",
    kind: "service",
    meta: "Go · net/http · pgx",
    memory: "128 MB",
    mount: "ro",
    layout: { wide: wide(520, 120), tall: tall(0, 192) },
  },
  {
    id: "api",
    name: "api",
    kind: "service",
    meta: "FastAPI · Python 3.13",
    memory: "768 MB",
    mount: "ro",
    layout: { wide: wide(520, 320), tall: tall(195, 192) },
  },
  {
    id: "redis",
    name: "redis",
    kind: "store",
    meta: "cache · volatile-lru",
    memory: "512 MB",
    layout: { wide: wide(790, 30), tall: tall(0, 288) },
  },
  {
    id: "postgres",
    name: "postgres",
    kind: "store",
    meta: "PostgreSQL 15 · pgvector",
    memory: "1 GB",
    layout: { wide: wide(790, 220), tall: tall(195, 288) },
  },
  {
    id: "durable",
    name: "redis-durable",
    kind: "store",
    meta: "broker · streams · AOF",
    memory: "512 MB",
    layout: { wide: wide(790, 400), tall: tall(195, 384) },
  },
  {
    id: "projector",
    name: "projector",
    kind: "service",
    meta: "outbox relay · snapshots",
    memory: "512 MB",
    mount: "ro",
    layout: { wide: wide(1030, 220), tall: tall(0, 384) },
  },
  {
    id: "workers",
    name: "workers · Dramatiq",
    kind: "group",
    inTrace: false,
    layout: { wide: wide(20, 520, 1200, 130), tall: tall(0, 480, 360, 260) },
  },
  worker(0, "worker", "default + fast queues", "1.5 GB", "rw"),
  worker(1, "fast-worker", "fast queue", "768 MB", "rw"),
  worker(2, "maintenance-worker", "maintenance queue", "1 GB", "rw"),
  worker(3, "analysis-worker", "heavy queue · DSP", "2 GB", "ro"),
  worker(4, "playback-worker", "ffmpeg transcodes", "1 GB", "ro"),
  worker(5, "media-worker", "Rust · ZIP packages", "256 MB", "ro"),
];

export const edges: MapEdgeDef[] = [
  { id: "listen-traefik", from: "listen", to: "traefik" },
  { id: "admin-traefik", from: "admin", to: "traefik" },
  { id: "traefik-frontends", from: "traefik", to: "frontends" },
  { id: "traefik-readplane", from: "traefik", to: "readplane" },
  { id: "traefik-api", from: "traefik", to: "api" },
  { id: "readplane-api", from: "readplane", to: "api", fallback: true },
  { id: "readplane-redis", from: "readplane", to: "redis" },
  { id: "readplane-postgres", from: "readplane", to: "postgres" },
  { id: "api-postgres", from: "api", to: "postgres" },
  { id: "api-durable", from: "api", to: "durable", only: "wide" },
  { id: "postgres-projector", from: "postgres", to: "projector" },
  { id: "redis-projector", from: "redis", to: "projector" },
  { id: "projector-durable", from: "projector", to: "durable" },
  { id: "durable-workers", from: "durable", to: "workers" },
];
