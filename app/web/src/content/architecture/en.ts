import scale from "../../data/scale.json";
import type { Feature, PageIntro } from "../../lib/chapters";

export interface SectionIntro {
  title: string;
  lede: string[];
}

export interface TraceStep {
  title: string;
  body: string;
  route: string[];
}

export interface Story {
  title: string;
  body: string[];
  facts: string[];
  visual?: "outbox" | "redis" | "uuid" | "governor";
}

export interface ScaleFigure {
  value: number;
  label: string;
  approx?: boolean;
}

export interface ArchitecturePage extends PageIntro {
  sections: Record<
    "map" | "trace" | "stories" | "scale" | "stack",
    SectionIntro
  >;
  map: { title: string; description: string; legend: string[] };
  trace: TraceStep[];
  stories: Story[];
  scale: ScaleFigure[];
  scaleNote: string;
  stack: Feature[];
}

export const architecture: ArchitecturePage = {
  meta: {
    title: "Architecture — Crate",
    description:
      "How Crate is built: a FastAPI core with a Go read plane in front, workers that own every write, a transactional outbox feeding Redis Streams, and the decisions behind them.",
  },
  eyebrow: "Architecture",
  title: "How Crate is built.",
  lede: "A Python API with a Go read plane in front, workers that own every write to your files, and an event pipeline that keeps every open screen current.",
  sections: {
    map: {
      title: "System map",
      lede: [
        "Every service, what it runs, how it mounts your music and how much memory it may use.",
      ],
    },
    trace: {
      title: "Follow one like",
      lede: [
        "Tap like in Listen. This is the path it takes to every other screen that is open.",
      ],
    },
    stories: {
      title: "Stories",
      lede: ["Twelve decisions, and the reasons behind them."],
    },
    scale: {
      title: "Scale",
      lede: ["The codebase, counted in tests and moving parts."],
    },
    stack: {
      title: "Stack",
      lede: ["Proven tools, each picked for one job."],
    },
  },
  map: {
    title: "Crate system map",
    description:
      "Listen and Admin reach Traefik, which routes reads to the Go read plane, writes to the FastAPI API and static apps to nginx. The read plane falls back to the API, reads PostgreSQL and subscribes to the cache Redis. The API writes PostgreSQL and enqueues work on the durable Redis. The projector moves events from PostgreSQL to the durable Redis stream, warms snapshots in PostgreSQL and publishes on the cache Redis. Six workers consume the durable Redis: worker, fast-worker and maintenance-worker mount /music read-write; analysis-worker, playback-worker and media-worker, like the API, read plane and projector, mount it read-only.",
    legend: [
      "ro / rw: how a service mounts /music",
      "Memory: the container limit",
      "Dashed line: fallback to the API",
      "Names drop the crate- prefix",
    ],
  },
  trace: [
    {
      title: "Tap",
      body: "You tap like in Listen. The request goes through Traefik to the API.",
      route: ["listen", "traefik", "api"],
    },
    {
      title: "One transaction",
      body: "The API writes the like and a row in domain_event_outbox in the same PostgreSQL transaction. Both are committed, or neither is.",
      route: ["api", "postgres"],
    },
    {
      title: "Relay",
      body: "The projector's relay leases outbox rows with SKIP LOCKED and appends them to the crate:domain_events stream in the durable Redis. A Lua script deduplicates each event by its uid and stamps a global sequence.",
      route: ["postgres", "projector", "durable"],
    },
    {
      title: "Project",
      body: "The projector reads the stream as a consumer group, warms the affected ui_snapshots and bumps their version. It acknowledges an event only once the snapshot is written.",
      route: ["durable", "projector", "postgres"],
    },
    {
      title: "Publish",
      body: "The projector announces the new snapshot version on Redis pub/sub.",
      route: ["projector", "redis"],
    },
    {
      title: "Deliver",
      body: "The Go read plane relays the update over Server-Sent Events to every open client. A client that reconnects replays what it missed with Last-Event-ID, and a heartbeat every 30 seconds keeps the stream alive.",
      route: ["redis", "readplane", "traefik", "listen"],
    },
  ],
  stories: [
    {
      title:
        "A 128 MB Go read plane in front of Python, with two layers of fallback",
      body: [
        "The hot GET routes and the SSE relay are served by a small Go service built on net/http, pgx and go-redis. It serves snapshots the projector has already warmed and never builds one itself. A 1,000-entry LRU with a two-second TTL absorbs bursts.",
        "When it struggles, two layers send traffic back to FastAPI. Traefik checks /readyz every five seconds and fails over. Inside the service, a circuit breaker opens for ten seconds after five failures, with a three-second fallback timeout. A contract-smoke tool compares its JSON with FastAPI's, route by route.",
      ],
      facts: ["Go", "128 MB", "0.25 CPU", "/music ro"],
    },
    {
      title: "Transactional outbox to Redis Streams",
      body: [
        "Every domain event is written to domain_event_outbox in the same transaction as the change it describes. There is no moment where the data changed and the event was lost, or the other way round.",
        "A relay leases rows with SKIP LOCKED and appends them to a Redis stream through a Lua script that deduplicates by event uid and stamps a global sequence. Consumers acknowledge only after the projection is warm. A Redis outage may delay projections but never loses committed events.",
      ],
      facts: ["domain_event_outbox", "crate:domain_events", "SKIP LOCKED"],
      visual: "outbox",
    },
    {
      title: "Your API can't corrupt your library",
      body: [
        "The API container mounts /music read-only. Tags, moves, deletes and artwork are written by worker tasks, and only the three workers that consume those queues mount the library read-write. In the full stack, Tidarr, the Tidal downloader, does too.",
        "Files are written to a temporary path and renamed into place, so a reader sees the old version or the new one, never half of each.",
      ],
      facts: ["api: ro", "3 workers: rw", "temp + rename"],
    },
    {
      title: "Two Redises, on purpose",
      body: [
        "One Redis is a cache: volatile-lru, allowed to forget. The other holds what must not be forgotten: the Dramatiq broker, the domain-event stream and leases, with an append-only file synced every second and eviction turned off.",
        "One instance would need to be a cache that never evicts or a queue that can. Two instances mean a cache under pressure never touches work in flight.",
      ],
      facts: ["volatile-lru", "AOF everysec", "noeviction"],
      visual: "redis",
    },
    {
      title: "Gapless in the browser: HTML5 first, WebAudio second",
      body: [
        "Listen plays through a vendored Gapless-5. A track starts on an HTML5 audio element, so playback begins as soon as data arrives, then moves to WebAudio for sample-accurate joins once the track is decoded.",
        "Crate carries three patches on top: a master output gain node, a setOutputChain hook for the equalizer and the analyser, and recovery when a WebAudio fetch fails mid-load.",
      ],
      facts: ["Gapless-5", "HTML5 → WebAudio", "3 patches"],
    },
    {
      title: "Deterministic UUIDv5 identities, MBID-first",
      body: [
        "Every artist, album, track and genre gets a UUIDv5 in the crate:entity-uids:v1 namespace. When a MusicBrainz ID exists, the identity comes from it. Otherwise it comes from normalised names.",
        "The same music gets the same ID after every rebuild and on every server, so catalogs, caches and clients agree on what a track is without a lookup table.",
      ],
      facts: ["UUIDv5", "MBID-first", "crate:entity-uids:v1"],
      visual: "uuid",
    },
    {
      title: "A media worker with five dependencies",
      body: [
        "Album and track ZIP packages are built by a Rust service limited to 256 MB. Its dependencies are crc32fast, lofty, serde, serde_json and sentry.",
        "HTTP/1.1 and ZIP64 are written by hand. Progress and cancellation travel through Redis, so a package can be followed and stopped while it builds.",
      ],
      facts: ["Rust", "256 MB", "5 crates", "ZIP64"],
    },
    {
      title: "Background work that yields to listeners",
      body: [
        "Each task is a PostgreSQL row, the source of truth, plus a Dramatiq message sent after the transaction commits. An advisory lock and a dedup key stop the same work from being queued twice.",
        "A resource governor defers heavy work when the load ratio passes 0.85 or iowait 25%, when swap passes 30% while memory is short, or when listeners or streams pass a configurable limit, which a standard install sets to zero. The heaviest maintenance runs only between 02:00 and 07:00. Daemons claim work with FOR UPDATE SKIP LOCKED, so several run side by side without stepping on each other.",
      ],
      facts: [
        `${scale.taskTypes} task types`,
        ...Object.entries(scale.taskQueues)
          .sort(([, a], [, b]) => b.length - a.length)
          .map(([queue, tasks]) => `${queue} ${tasks.length}`),
      ],
      visual: "governor",
    },
    {
      title: "One planner, two players that don't trust it",
      body: [
        "Smart Mix transitions are planned once, by a pure Python planner on the server. The Android player and the VirtualDJ plugin, still in development, validate every plan again before they run it, against the tracks, cue points and limits they actually have.",
        "Shared fixtures pin the contract. Python and Java read the same transition plans, Python and Rust the same beat grids, so a plan means the same thing on the server and on the phone.",
      ],
      facts: ["Python", "Rust", "Java"],
    },
    {
      title: "Rust and Python analyzers with a parity check",
      body: [
        "Smart Mix profiles, with cue points, beat grid and loudness, come from a Rust analyzer or from a Python fallback. Every profile records which analyzer produced it.",
        "A parity check in CI runs both on the same audio and compares the results, so the planner can trust a profile whichever analyzer wrote it.",
      ],
      facts: ["crate-rust", "crate-python", "CI parity"],
    },
    {
      title: "Publishing analysis while files change underneath",
      body: [
        "Analysis takes time, and files can be retagged or replaced while it runs. Each job records the file's identity and a generation before it starts, and analyses outside any database transaction.",
        "It publishes with compare-and-swap, only if the file and the profile are still the ones it started from. Otherwise the draft is discarded and the track is queued again. A late job never overwrites a newer result.",
      ],
      facts: ["generation tags", "compare-and-swap"],
    },
    {
      title: "Two ExoPlayers behind one MediaSession",
      body: [
        "A Smart Mix transition on Android needs two decks playing at once. Crate runs two Media3 ExoPlayers behind one ForwardingSimpleBasePlayer, so Android sees one player, one MediaSession and one notification, and the queue advances once.",
        "The fade is computed per audio frame inside an AudioProcessor rather than on a timer on the main thread, so a busy interface cannot make it stutter.",
      ],
      facts: ["Media3", "ForwardingSimpleBasePlayer", "AudioProcessor"],
    },
  ],
  scale: [
    { value: scale.pytest, label: "pytest cases", approx: true },
    { value: scale.vitest, label: "Vitest cases", approx: true },
    { value: scale.goTests, label: "Go tests" },
    { value: scale.rustTests, label: "Rust tests" },
    { value: scale.taskTypes, label: "task types" },
    { value: scale.migrations, label: "migrations" },
  ],
  scaleNote: "Counted in the repository. Test totals are approximate.",
  stack: [
    {
      title: "Backend",
      body: "Python 3.13, FastAPI, SQLAlchemy and Dramatiq.",
    },
    {
      title: "Data",
      body: "PostgreSQL 15 with pgvector. Redis 7, twice.",
    },
    {
      title: "Go",
      body: "The read plane.",
    },
    {
      title: "Rust",
      body: "crate-cli for bliss vectors and audio tooling, the media worker and the Tauri desktop shell.",
    },
    {
      title: "Audio",
      body: "Essentia, librosa, PyTorch on CPU for PANNs, and ffmpeg.",
    },
    {
      title: "Frontend",
      body: "React 19, Vite and Tailwind 4.",
    },
    {
      title: "Apps",
      body: "Capacitor for Android and Tauri 2 for macOS, Windows and Linux.",
    },
  ],
};
