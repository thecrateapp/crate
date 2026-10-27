// What Admin shows as "work in progress" during the takes: a new Kompromat album arriving from
// Tidal, a Moderat album from Soulseek, and the pipeline that follows. Every value derives from
// the seconds since the page loaded, so each reconnect of a live stream moves the story on.

const KOMPROMAT = "Kompromat - PLДYING / PRДYING";
const KOMPROMAT_TRACKS = [
  "I LET MYSELF GO BLIND",
  "LIFT ME UP",
  "PLAYING / PRAYING",
  "NO STRANGER TO HEARTBREAK",
  "ONLY IN YOUR ARMS",
  "FOREVER",
  "I SURRENDER",
  "INTELLIGENCE ARTIFICIELLE",
];
const MODERAT_TRACKS = ["FAST LAND", "EASY PREY", "DRUM GLOW", "SOFT EDIT"];
const ENRICHMENT_PHASES = [
  "lastfm",
  "musicbrainz",
  "fanart",
  "spotify",
  "discogs",
  "setlistfm",
];
const POOLS = ["fast", "default", "heavy", "maintenance", "playback"] as const;

type Pool = (typeof POOLS)[number];

export interface StagedTask {
  id: string;
  type: string;
  label: string;
  status: "running" | "pending";
  pool: Pool;
  progress: {
    done: number;
    total: number;
    percent: number;
    item: string;
    phase: string;
    phase_index: number;
    phase_count: number;
    rate: number;
    eta_sec: number;
    errors: number;
    warnings: number;
  };
  created_at: string;
  started_at: string | null;
  updated_at: string;
}

export interface AdminScene {
  running: StagedTask[];
  pending: StagedTask[];
  queueBreakdown: {
    running: Record<Pool, number>;
    pending: Record<Pool, number>;
  };
  analysis: { active: number; pending: number };
  tidal: {
    title: string;
    artist: string;
    status: "downloading" | "processing" | "queued";
  }[];
  soulseek: {
    artist: string;
    album: string;
    filename: string;
    progress: number;
    status: string;
    speed: number;
  }[];
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

function task(
  id: string,
  type: string,
  label: string,
  pool: Pool,
  now: Date,
  status: "running" | "pending",
  progress: Partial<StagedTask["progress"]> = {},
): StagedTask {
  const done = progress.done ?? 0;
  const total = progress.total ?? 0;
  const iso = now.toISOString();
  return {
    id,
    type,
    label,
    status,
    pool,
    progress: {
      done,
      total,
      percent:
        progress.percent ??
        (total ? Math.round((done / total) * 1000) / 10 : 0),
      item: progress.item ?? "",
      phase: progress.phase ?? "",
      phase_index: progress.phase_index ?? 0,
      phase_count: progress.phase_count ?? 1,
      rate: progress.rate ?? 0,
      eta_sec: progress.eta_sec ?? 0,
      errors: 0,
      warnings: 0,
    },
    created_at: iso,
    started_at: status === "running" ? iso : null,
    updated_at: iso,
  };
}

export function adminScene(elapsed: number, now = new Date()): AdminScene {
  const t = Math.max(elapsed, 0);
  const analysed = clamp(Math.floor(t / 0.9), 0, KOMPROMAT_TRACKS.length);
  const imported = clamp(Math.floor(t / 0.6) + 2, 0, KOMPROMAT_TRACKS.length);
  const phase = Math.floor(t / 1.2) % ENRICHMENT_PHASES.length;
  const downloadPercent = clamp(46 + t * 9, 0, 100);

  const running = [
    task(
      "film-tidal",
      "tidal_download",
      "Tidal Download",
      "fast",
      now,
      "running",
      {
        percent: Math.round(downloadPercent),
        item: KOMPROMAT,
        phase: downloadPercent < 100 ? "download" : "import",
      },
    ),
    task(
      "film-process",
      "process_new_content",
      "Process New Content",
      "default",
      now,
      "running",
      {
        done: imported,
        total: KOMPROMAT_TRACKS.length,
        item: KOMPROMAT_TRACKS[Math.max(imported - 1, 0)],
        phase: "tags",
      },
    ),
    task(
      "film-enrich",
      "enrich_artist",
      "Artist Enrichment",
      "default",
      now,
      "running",
      {
        done: phase + 1,
        total: ENRICHMENT_PHASES.length,
        item: "Kompromat",
        phase: ENRICHMENT_PHASES[phase],
        phase_index: phase,
        phase_count: ENRICHMENT_PHASES.length,
      },
    ),
    task(
      "film-analysis",
      "analyze_album_full",
      "Album Analysis",
      "heavy",
      now,
      "running",
      {
        done: analysed,
        total: KOMPROMAT_TRACKS.length,
        item: KOMPROMAT_TRACKS[Math.min(analysed, KOMPROMAT_TRACKS.length - 1)],
        phase: "features",
        rate: 1.1,
        eta_sec: Math.round((KOMPROMAT_TRACKS.length - analysed) * 0.9),
      },
    ),
  ];
  if (t >= 4) {
    running.push(
      task(
        "film-bliss",
        "compute_bliss",
        "Bliss Similarity",
        "heavy",
        now,
        "running",
        {
          done: clamp(Math.floor((t - 4) / 0.7), 0, KOMPROMAT_TRACKS.length),
          total: KOMPROMAT_TRACKS.length,
          phase: "vectors",
        },
      ),
    );
  }
  const pending = [
    task(
      "film-cover",
      "fetch_album_cover",
      "Fetch Album Cover",
      "fast",
      now,
      "pending",
    ),
    task(
      "film-genres",
      "index_genres",
      "Genre Indexing",
      "maintenance",
      now,
      "pending",
    ),
    task(
      "film-popularity",
      "compute_popularity",
      "Popularity Update",
      "maintenance",
      now,
      "pending",
    ),
    task(
      "film-smart-mix",
      "refresh_smart_mix_coverage",
      "Smart Mix Coverage",
      "heavy",
      now,
      "pending",
    ),
  ];
  if (t < 4)
    pending.unshift(
      task(
        "film-bliss",
        "compute_bliss",
        "Bliss Similarity",
        "heavy",
        now,
        "pending",
      ),
    );

  const count = (tasks: StagedTask[]) =>
    Object.fromEntries(
      POOLS.map((pool) => [
        pool,
        tasks.filter((entry) => entry.pool === pool).length,
      ]),
    ) as Record<Pool, number>;

  return {
    running,
    pending,
    queueBreakdown: { running: count(running), pending: count(pending) },
    analysis: {
      active: analysed < KOMPROMAT_TRACKS.length ? 1 : 0,
      pending: KOMPROMAT_TRACKS.length - analysed,
    },
    tidal: [
      {
        title: KOMPROMAT,
        artist: "Kompromat",
        status: downloadPercent < 100 ? "downloading" : "processing",
      },
      { title: "Four Tet - Three", artist: "Four Tet", status: "queued" },
    ],
    soulseek: MODERAT_TRACKS.map((title, index) => ({
      artist: "Moderat",
      album: "MORE D4TA",
      filename: `0${index + 1} ${title}.flac`,
      progress: Math.round(clamp(34 - index * 14 + t * 6, 0, 100)),
      status:
        clamp(34 - index * 14 + t * 6, 0, 100) >= 100
          ? "Completed, Succeeded"
          : "InProgress",
      speed: 2_400_000 - index * 350_000,
    })),
  };
}
