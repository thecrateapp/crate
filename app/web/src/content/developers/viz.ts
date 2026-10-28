export const TOKEN = {
  prefix: "crv_",
  bytes: 32,
  displayPrefixLength: 12,
  example: "crv_Q2x9Tf7mLw4pR8sVb1nK0cYdE6hJ3gUa5zXoWqNtMiA",
};

export const SCOPES = [
  "vdj.catalog.read",
  "vdj.media.read",
  "vdj.smart_mix.read",
  "vdj.play_events.write",
];

export const CAPABILITIES = {
  smart_mix: {
    available: true,
    planner_version: "smart-mix-v2",
    android_native_crossfade: true,
  },
  vdj: {
    available: false,
    contract_version: "2026-08",
    profile_schema_version: 1,
    planner_version: "smart-mix-v2",
    online_source: false,
    smart_mix_assistant: false,
  },
  access_token: {
    scopes: SCOPES,
  },
};

export type Method = "GET" | "HEAD" | "POST";

export interface Route {
  methods: Method[];
  pattern: string;
  label: string;
}

const ENTITY = "[^/]+";

export const ALLOWLIST: Route[] = [
  { methods: ["GET"], pattern: "/api/search", label: "/api/search" },
  { methods: ["GET"], pattern: "/api/auth/me", label: "/api/auth/me" },
  {
    methods: ["GET"],
    pattern: "/api/capabilities",
    label: "/api/capabilities",
  },
  {
    methods: ["GET"],
    pattern: "/api/vdj/catalog/folders",
    label: "/api/vdj/catalog/folders",
  },
  {
    methods: ["GET"],
    pattern: "/api/vdj/catalog/folders/[^/]+",
    label: "/api/vdj/catalog/folders/{id}",
  },
  {
    methods: ["POST"],
    pattern: "/api/auth/media-access",
    label: "/api/auth/media-access",
  },
  {
    methods: ["POST"],
    pattern: "/api/playback/transition-plans",
    label: "/api/playback/transition-plans",
  },
  {
    methods: ["POST"],
    pattern: "/api/me/play-events",
    label: "/api/me/play-events",
  },
  {
    methods: ["GET"],
    pattern: `/api/tracks/by-entity/${ENTITY}/(?:mix-profile|compatible|playback)`,
    label: "/api/tracks/by-entity/{uid}/mix-profile · compatible · playback",
  },
  {
    methods: ["GET", "HEAD"],
    pattern: `/api/tracks/by-entity/${ENTITY}/stream`,
    label: "/api/tracks/by-entity/{uid}/stream",
  },
  {
    methods: ["GET"],
    pattern: `/api/vdj/tracks/by-entity/${ENTITY}/playback`,
    label: "/api/vdj/tracks/by-entity/{uid}/playback",
  },
  {
    methods: ["GET", "HEAD"],
    pattern: `/api/vdj/tracks/by-entity/${ENTITY}/stream`,
    label: "/api/vdj/tracks/by-entity/{uid}/stream",
  },
];

export const PROBES: { method: string; path: string }[] = [
  { method: "GET", path: "/api/capabilities" },
  {
    method: "GET",
    path: "/api/tracks/by-entity/203e2dd3-5cdc-580c-a43b-6c54fd1dade6/mix-profile",
  },
  { method: "GET", path: "/api/admin/users" },
  { method: "POST", path: "/api/playback/transition-plans" },
  { method: "DELETE", path: "/api/albums/412" },
  {
    method: "HEAD",
    path: "/api/tracks/by-entity/203e2dd3-5cdc-580c-a43b-6c54fd1dade6/stream",
  },
  { method: "POST", path: "/api/me/play-events" },
  { method: "GET", path: "/api/me/library" },
];

export function allowlistMatch(
  method: string,
  path: string,
  routes: readonly Route[] = ALLOWLIST,
): number {
  const upper = method.toUpperCase();
  return routes.findIndex(
    (route) =>
      route.methods.includes(upper as Method) &&
      new RegExp(`^(?:${route.pattern})$`).test(path),
  );
}
