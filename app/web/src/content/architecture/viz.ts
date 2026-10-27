export const REDIS = {
  cache: {
    service: "crate-redis",
    maxmemory: "512mb",
    policy: "volatile-lru",
    appendonly: false,
  },
  durable: {
    service: "crate-redis-durable",
    maxmemory: "384mb",
    policy: "noeviction",
    appendonly: true,
    fsync: "everysec",
  },
};

export const CACHE_KEYS = [
  "snapshot:home:7",
  "artist:slowdive",
  "stats:week:7",
  "radio:seed:1c9a2b45",
  "genre:shoegaze",
  "search:souvlaki",
  "snapshot:album:412",
  "lyrics:203e2dd3",
];

export const DURABLE_WRITES = [
  "XADD crate:domain_events * type track.liked",
  "LPUSH dramatiq:fast enrich_artist",
  "SET lease:projector:relay EX 30",
  "XADD crate:domain_events * type album.imported",
  "LPUSH dramatiq:maintenance health_check",
  "XACK crate:domain_events projector 1042",
];

export const OUTBOX_STEPS = [
  {
    from: "api",
    to: "postgres",
    text: "BEGIN · INSERT like · INSERT domain_event_outbox · COMMIT",
  },
  { from: "relay", to: "postgres", text: "SELECT … FOR UPDATE SKIP LOCKED" },
  {
    from: "relay",
    to: "stream",
    text: "EVAL dedupe by uid · XADD crate:domain_events · seq 1042",
  },
  { from: "projector", to: "stream", text: "XREADGROUP projector" },
  {
    from: "projector",
    to: "postgres",
    text: "UPSERT ui_snapshots · version + 1",
  },
  {
    from: "projector",
    to: "stream",
    text: "XACK 1042 · only after the snapshot is warm",
  },
];

export const OUTBOX_LANES = [
  { id: "api", label: "api" },
  { id: "postgres", label: "postgres" },
  { id: "relay", label: "relay" },
  { id: "stream", label: "redis-durable" },
  { id: "projector", label: "projector" },
];
