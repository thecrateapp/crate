import type { PhaseTrack } from "./phase-clock";

/**
 * T01 figure: one background refresh of an artist by `enrich_artist`, eight
 * days after its last run. The fetch order, the source-cache TTLs and the
 * default pool of three come from app/crate/enrichment.py at 224d3378; the tag
 * merge from `enrich_artist`; the write rule (`value is not None and
 * locked_field not in locked_fields`) from `update_artist_enrichment` in
 * app/crate/db/repositories/library_enrichment_writes.py at the same commit.
 * The artist, its payloads, the failure and the timings are illustrative.
 */

export type SourceId =
  "lastfm" | "spotify" | "musicbrainz" | "setlist" | "fanart" | "discogs";
export type FieldId = "bio" | "tags" | "spotify_followers" | "country";

export interface Source {
  id: SourceId;
  label: string;
  ttlDays: number;
  /** Whether its payload feeds `persist_data`, or stays in the enrichment cache only. */
  row: boolean;
}

/** `_ENRICHMENT_FETCH_ORDER` with `_SOURCE_TTLS_SECONDS` in days. */
export const SOURCES: readonly Source[] = [
  { id: "lastfm", label: "Last.fm", ttlDays: 7, row: true },
  { id: "spotify", label: "Spotify", ttlDays: 3, row: true },
  { id: "musicbrainz", label: "MusicBrainz", ttlDays: 30, row: true },
  { id: "setlist", label: "Setlist.fm", ttlDays: 1, row: false },
  { id: "fanart", label: "Fanart.tv", ttlDays: 30, row: false },
  { id: "discogs", label: "Discogs", ttlDays: 30, row: true },
];

/** `_get_enrichment_parallelism` default. */
export const PARALLELISM = 3;
/** Days since the artist's previous run (past the 24-hour guard). */
export const AGE_DAYS = 8;
export const ARTIST = "Harrow Lane";

/** `get_cache(key, max_age_seconds=ttl)` hits while the entry is younger than its TTL. */
export const isCached = (source: { ttlDays: number }, ageDays: number) =>
  ageDays < source.ttlDays;

export const ENRICHMENT_STATES = [
  {
    id: "run",
    label: "Refresh",
    phases: [
      {
        title: "Check caches",
        body: "Eight days on, MusicBrainz, Fanart.tv and Discogs are still inside their 30-day entries. They take no fetch slot.",
      },
      {
        title: "Fetch misses",
        body: "The three expired sources run together in the pool. Last.fm fails, so its fetcher returns `None` and nothing is cached for it.",
      },
      {
        title: "Assemble",
        body: "After the batch, one thread builds `persist_data`: no biography, tags from Spotify alone, MusicBrainz's country.",
      },
      {
        title: "Write",
        body: "The writer skips `None` and locked fields. The biography and the corrected country stay; tags are replaced.",
      },
    ],
  },
] as const satisfies readonly {
  id: string;
  label: string;
  phases: readonly { title: string; body: string }[];
}[];

export type EnrichmentState = (typeof ENRICHMENT_STATES)[number]["id"];

export const ENRICHMENT_TRACKS: Record<EnrichmentState, PhaseTrack> = {
  run: { period: 10, starts: [0, 2, 5.4, 7.6], pins: [1.9, 5.2, 7.3, 9.2] },
};

/** The job's own thread: cache check, wait for the batch, assemble, write. */
export const STEPS = [
  { id: "check", label: "check caches", start: 0.2, end: 1.8 },
  { id: "wait", label: "wait for batch", start: 2, end: 5 },
  { id: "assemble", label: "assemble", start: 5.4, end: 7.4 },
  { id: "write", label: "write", start: 7.6, end: 8.8 },
] as const;

export interface Job {
  source: SourceId;
  lane: number;
  start: number;
  end: number;
  ok: boolean;
}

const DURATION: Partial<Record<SourceId, number>> = {
  lastfm: 2.8,
  spotify: 1.6,
  setlist: 2.2,
};
const FAILS: ReadonlySet<SourceId> = new Set(["lastfm"]);
const FETCH_AT = 2.2;

/** Misses go to the pool in fetch order; with three misses each gets a worker. */
export const JOBS: readonly Job[] = SOURCES.filter(
  (source) => !isCached(source, AGE_DAYS),
).map((source, index) => ({
  source: source.id,
  lane: index % PARALLELISM,
  start: FETCH_AT,
  end: FETCH_AT + (DURATION[source.id] ?? 1.5),
  ok: !FAILS.has(source.id),
}));

export interface Payloads {
  lastfm?: { bio?: string; tags?: string[] } | null;
  spotify?: { followers?: number; genres?: string[] } | null;
  musicbrainz?: { country?: string } | null;
}

/** This run's payloads; Last.fm failed and returned nothing. */
export const PAYLOADS: Payloads = {
  lastfm: null,
  spotify: { followers: 18950, genres: ["nu gaze", "canadian shoegaze"] },
  musicbrainz: { country: "GB" },
};

export interface ArtistRow {
  bio: string | null;
  tags: string[];
  spotify_followers: number | null;
  country: string | null;
}

/** The stored row from the previous run, with a manual country correction. */
export const STORED: ArtistRow = {
  bio: "Harrow Lane are a four-piece from Halifax, Nova Scotia.",
  tags: ["shoegaze", "dream pop", "canadian", "nu gaze", "canadian shoegaze"],
  spotify_followers: 18240,
  country: "CA",
};
export const LOCKED: ReadonlySet<FieldId> = new Set(["country"]);

export type Persist = Partial<Record<FieldId, string | number | string[]>>;

/** The subset of `enrich_artist`'s assembly that the figure shows. */
export function assemble(payloads: Payloads): Persist {
  const persist: Persist = {};
  const lastfm = payloads.lastfm;
  if (lastfm) {
    persist.bio = lastfm.bio ?? "";
    persist.tags = lastfm.tags ?? [];
  }
  const spotify = payloads.spotify;
  if (spotify) {
    if (spotify.followers !== undefined)
      persist.spotify_followers = spotify.followers;
    const genres = spotify.genres ?? [];
    if (genres.length) {
      const existing = (persist.tags as string[] | undefined) ?? [];
      persist.tags = [...new Set([...existing, ...genres])];
    }
  }
  if (payloads.musicbrainz?.country !== undefined)
    persist.country = payloads.musicbrainz.country;
  return persist;
}

export type Outcome = "kept" | "locked" | "replaced" | "set";

/** `update_artist_enrichment`: set a column only for a value that is not None and not locked. */
export function writeRow(
  stored: ArtistRow,
  persist: Persist,
  locked: ReadonlySet<string>,
): { row: ArtistRow; outcomes: Record<FieldId, Outcome> } {
  const row = { ...stored } as Record<FieldId, unknown>;
  const outcomes = {} as Record<FieldId, Outcome>;
  for (const id of Object.keys(stored) as FieldId[]) {
    const value = persist[id] ?? null;
    if (value === null) outcomes[id] = "kept";
    else if (locked.has(id)) outcomes[id] = "locked";
    else {
      row[id] = value;
      outcomes[id] = Array.isArray(value) ? "replaced" : "set";
    }
  }
  return { row: row as unknown as ArtistRow, outcomes };
}

const PERSIST = assemble(PAYLOADS);
const WRITTEN = writeRow(STORED, PERSIST, LOCKED);

// ── Timeline ────────────────────────────────────────────────────────────────

const CHECK_AT = 0.9;
const PARK = 0.5;
const HIT_PARK_AT = CHECK_AT + 0.3;
const PROPOSE_AT: Record<FieldId, number> = {
  bio: 5.6,
  tags: 6,
  spotify_followers: 6.4,
  country: 6.8,
};
const WRITE_AT = 7.9;
const FLOW = { from: 7.6, to: 8.2 };

export const VIEW = { width: 400, height: 300 };
export const CENTER = { x: 200, y: 150 };
export const NODE_R = 96;
export const RING_R = 50;
export const CORE_R = 24;

/** Sources sit clockwise from the top in fetch order. */
export function angleOf(id: SourceId): number {
  const index = SOURCES.findIndex((source) => source.id === id);
  return ((-90 + index * 60) * Math.PI) / 180;
}

export function polar(id: SourceId, radius: number) {
  const angle = angleOf(id);
  return {
    x: CENTER.x + Math.cos(angle) * radius,
    y: CENTER.y + Math.sin(angle) * radius,
  };
}

export type SourceStatus =
  "idle" | "hit" | "queued" | "fetching" | "received" | "failed";

export interface SourceFrame {
  id: SourceId;
  status: SourceStatus;
  note: string;
  /** Fraction of the TTL the cache entry has used, drawn as an arc. */
  ttlUsed: number;
  expired: boolean;
  /** Progress of the request along the link. */
  link: number;
  /** Packet position along the link (0 node, 1 ring); null when hidden. */
  packet: { x: number; y: number } | null;
  parked: boolean;
  /** Parked payload moving into the row during the write, 0..1. */
  flow: number;
  saved: boolean;
}

export interface StepFrame {
  id: string;
  fill: number;
}

export interface JobFrame {
  source: SourceId;
  fill: number;
  status: "queued" | "running" | "done" | "failed";
}

export interface FieldFrame {
  id: FieldId;
  stage: "stored" | "proposed" | "written";
  value: string;
  note: string;
  outcome?: Outcome;
}

export interface EnrichmentFrame {
  sources: SourceFrame[];
  steps: StepFrame[];
  jobs: JobFrame[];
  busy: number;
  hits: number | null;
  received: number;
  failed: boolean;
  row: "unchanged" | "assembling" | "written";
  fields: FieldFrame[];
  /** `enriched_at`, which the writer sets even though a source failed. */
  stamp: string;
  head: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const ease = (k: number) => {
  const t = clamp01(k);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
const progress = (t: number, from: number, to: number) =>
  clamp01((t - from) / (to - from));

const ASSEMBLED_NOTES: Record<SourceId, string> = {
  lastfm: "no biography",
  spotify: "genres, followers",
  musicbrainz: `proposes ${PERSIST.country}`,
  setlist: "payload only",
  fanart: "payload only",
  discogs: "id, profile",
};

function sourceFrame(source: Source, t: number): SourceFrame {
  const hit = isCached(source, AGE_DAYS);
  const job = JOBS.find((item) => item.source === source.id);
  const ttlUsed =
    clamp01(AGE_DAYS / source.ttlDays) * ease(progress(t, 0.3, CHECK_AT));
  const checked = t >= CHECK_AT;
  const node = NODE_R - 14;
  const along = (k: number) => {
    const r = node + (RING_R + 4 - node) * k;
    return polar(source.id, r);
  };

  let status: SourceStatus = "idle";
  let link = 0;
  let packetK: number | null = null;
  let parkedAt = Infinity;
  if (checked && hit) {
    status = "hit";
    link = 1;
    parkedAt = HIT_PARK_AT;
    if (t < HIT_PARK_AT) packetK = progress(t, CHECK_AT, HIT_PARK_AT);
  } else if (checked && job) {
    status = "queued";
    if (t >= job.start) {
      status = "fetching";
      link = progress(t, job.start, job.end);
    }
    if (t >= job.end) {
      status = job.ok ? "received" : "failed";
      if (job.ok) {
        parkedAt = job.end + PARK;
        if (t < parkedAt) packetK = progress(t, job.end, parkedAt);
      }
    }
  }
  const parked = t >= parkedAt;
  const flow = parked && source.row ? ease(progress(t, FLOW.from, FLOW.to)) : 0;
  // Non-breaking spaces keep "30 d" and "hit ·" together when a label wraps.
  const days = `${source.ttlDays}\u00a0d`;
  const note =
    t >= STEPS[2].start && status !== "idle"
      ? ASSEMBLED_NOTES[source.id]
      : status === "hit"
        ? `hit\u00a0· ${days}`
        : status === "queued"
          ? `expired\u00a0· ${days}`
          : status === "fetching"
            ? "fetching"
            : status === "received"
              ? "received"
              : status === "failed"
                ? "failed\u00a0· None"
                : `TTL ${days}`;
  return {
    id: source.id,
    status,
    note,
    ttlUsed,
    expired: checked && !hit,
    link,
    packet: packetK === null ? null : along(ease(packetK)),
    parked,
    flow,
    saved: t >= WRITE_AT && parked && source.row,
  };
}

const list = (tags: string[], max = 3) =>
  tags.length > max
    ? `${tags.slice(0, max).join(" · ")} +${tags.length - max}`
    : tags.join(" · ");
const number = (value: number | null) =>
  value === null ? "None" : value.toLocaleString("en-US");

function display(id: FieldId, value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (id === "tags") return list(value as string[]);
  if (id === "spotify_followers") return number(value as number);
  return String(value);
}

const STORED_NOTES: Record<FieldId, string> = {
  bio: "stored · Last.fm",
  tags: "stored · Last.fm + Spotify",
  spotify_followers: "stored · Spotify",
  country: "manual edit · locked",
};

function writtenNote(id: FieldId, outcome: Outcome): string {
  if (outcome === "kept") return "None · stored text kept";
  if (outcome === "locked")
    return `locked · ${display(id, PERSIST[id])} not written`;
  if (id === "tags")
    return `${STORED.tags.length} tags → ${WRITTEN.row.tags.length}, Spotify only`;
  return `was ${display(id, STORED[id])}`;
}

function fieldFrame(id: FieldId, t: number): FieldFrame {
  if (t >= WRITE_AT) {
    const outcome = WRITTEN.outcomes[id];
    return {
      id,
      stage: "written",
      value: display(id, WRITTEN.row[id]),
      note: writtenNote(id, outcome),
      outcome,
    };
  }
  if (t >= PROPOSE_AT[id]) {
    const proposed = PERSIST[id];
    const stored =
      id === "tags" ? `${STORED.tags.length} tags` : display(id, STORED[id]);
    return {
      id,
      stage: "proposed",
      value: display(id, proposed),
      note:
        proposed === undefined
          ? "proposed · no Last.fm payload"
          : `proposed · stored ${stored}`,
    };
  }
  return {
    id,
    stage: "stored",
    value: display(id, STORED[id]),
    note: STORED_NOTES[id],
  };
}

export const FIELDS: readonly { id: FieldId; source: string }[] = [
  { id: "bio", source: "Last.fm" },
  { id: "tags", source: "Last.fm + Spotify" },
  { id: "spotify_followers", source: "Spotify" },
  { id: "country", source: "MusicBrainz" },
];

export function enrichmentFrame(t: number): EnrichmentFrame {
  const sources = SOURCES.map((source) => sourceFrame(source, t));
  const jobs = JOBS.map((job) => ({
    source: job.source,
    fill: progress(t, job.start, job.end),
    status:
      t < job.start
        ? ("queued" as const)
        : t < job.end
          ? ("running" as const)
          : job.ok
            ? ("done" as const)
            : ("failed" as const),
  }));
  return {
    sources,
    steps: STEPS.map((step) => ({
      id: step.id,
      fill: progress(t, step.start, step.end),
    })),
    jobs,
    busy: jobs.filter((job) => job.status === "running").length,
    hits:
      t >= CHECK_AT ? sources.filter((s) => s.status === "hit").length : null,
    received: sources.filter((source) => source.parked).length,
    failed: sources.some((source) => source.status === "failed"),
    row:
      t >= WRITE_AT
        ? "written"
        : t >= STEPS[2].start
          ? "assembling"
          : "unchanged",
    fields: FIELDS.map((item) => fieldFrame(item.id, t)),
    stamp: t >= WRITE_AT ? "now" : `${AGE_DAYS} days ago`,
    head: t / ENRICHMENT_TRACKS.run.period,
  };
}

type Tone = "warn" | "ok" | undefined;
interface Value {
  text: string;
  tone: Tone;
}

export function enrichmentReadout(frame: EnrichmentFrame): {
  hits: Value;
  payloads: Value;
  row: Value;
  bio: Value;
} {
  const bio = frame.fields.find((item) => item.id === "bio")!;
  return {
    hits:
      frame.hits === null
        ? { text: "–", tone: undefined }
        : { text: `${frame.hits} / ${SOURCES.length}`, tone: "ok" },
    payloads: {
      text: `${frame.received} / ${SOURCES.length}`,
      tone: frame.failed ? "warn" : undefined,
    },
    row:
      frame.row === "written"
        ? { text: "Written", tone: "ok" }
        : frame.row === "assembling"
          ? { text: "Assembling", tone: undefined }
          : { text: "Unchanged", tone: undefined },
    bio:
      bio.stage === "written"
        ? bio.outcome === "kept"
          ? { text: "Kept", tone: "ok" }
          : { text: "Written", tone: undefined }
        : bio.stage === "proposed"
          ? { text: "None", tone: "warn" }
          : { text: "Stored", tone: undefined },
  };
}
