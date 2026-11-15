// The Stems tab of a track's Audio profile dialog (Smart Mix Stems, ST2.PR4): the
// response of GET /api/smart-mix/tracks/{id}/stems and the model the tab draws.

export type StemName = "drums" | "bass" | "other" | "vocals";
export const STEMS: StemName[] = ["drums", "bass", "other", "vocals"];

export type StemJobState = "pending" | "analyzing" | "ready" | "failed";

export interface SmartMixUserRef {
  id: number;
  username: string | null;
}

export interface LanePhrase {
  startMs: number;
  endMs: number;
  kind: string;
  bars: number;
  voiced: boolean | null;
}

export interface LayerPhrase {
  startMs: number;
  endMs: number;
  drums: number;
  bass: number;
  other: number;
  vocals: number;
}

export interface SmartMixTrackStemAnalysis {
  producerKind: "server" | "decks";
  producer: string;
  separatorModel: string;
  separatorVersion: string;
  sourceRevision: string;
  hopMs: number;
  durationMs: number;
  /** Base64, one byte per window: −60 dBFS (0) to 0 dBFS (255). */
  levels: Record<StemName, string>;
  drumBeatsMs: number[] | null;
  current: boolean;
  chosen: boolean;
  createdAt: string;
  updatedAt: string;
  contributedBy: SmartMixUserRef | null;
}

export interface SmartMixTrackStemJob {
  state: StemJobState;
  attempts: number;
  maxAttempts: number;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Only for library.analysis.manage. */
  lastError: string | null;
  secondsPerTrack: number;
}

export interface SmartMixTrackStemFile {
  bytes: number;
  separatorModel: string;
  separatorVersion: string;
  sourceRevision: string;
  current: boolean;
  createdAt: string;
  lastUsedAt: string;
}

export interface SmartMixTrackPlaylist {
  playlistId: number;
  name: string;
  owner: SmartMixUserRef | null;
  enabled: boolean;
  ready: number;
  total: number;
}

export interface SmartMixTrackStems {
  trackId: number;
  trackEntityUid: string | null;
  durationMs: number | null;
  sourceRevision: string | null;
  profileAnalyzedAt: string | null;
  sourceStaleAt: string | null;
  vocalDetector: string | null;
  phrases: LanePhrase[];
  analyses: SmartMixTrackStemAnalysis[];
  stems: {
    producer: string;
    separatorModel: string;
    separatorVersion: string;
    phrases: LayerPhrase[];
  } | null;
  job: SmartMixTrackStemJob | null;
  file: SmartMixTrackStemFile | null;
  playlists: SmartMixTrackPlaylist[];
}

export interface StemsTabModel {
  canManage: boolean;
  durationMs: number;
  phrases: LanePhrase[];
  voiceDetector: string | null;
  analysis: null | {
    kind: "server" | "decks";
    producer: string;
    contributedBy: string | null;
    separatorModel: string;
    separatorVersion: string;
    sourceRevision: string;
    current: boolean;
    fileChangedAt: string | null;
    analysedAt: string;
    levels: Record<StemName, number[]>;
    hopMs: number;
    drumBeatsMs: number[] | null;
  };
  layer: LayerPhrase[] | null;
  layerNote: string | null;
  files:
    | { stored: false; note: string }
    | { stored: true; size: string; streams: string; lastUsed: string };
  playlists: {
    id: number;
    name: string;
    owner: string;
    enabled: boolean;
    ready: number;
    total: number;
  }[];
  job: null | {
    state: StemJobState;
    attempts: number;
    detail: string;
    lastError: string | null;
  };
}

const STEM_STREAMS = "drums, bass, vocals · AAC 3 × 256 kbps";

/** Like the Phrases tab: the tab exists only when there is something to show. */
export function hasStemData(data: SmartMixTrackStems | null | undefined) {
  if (!data) return false;
  return (
    (data.analyses?.length ?? 0) > 0 ||
    data.file != null ||
    (data.job != null && data.job.state !== "ready")
  );
}

export function decodeLevels(base64: string): number[] {
  const binary = atob(base64);
  const bytes = new Array<number>(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function dateTime(value: string | null | undefined, seconds = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return seconds
    ? date.toLocaleString()
    : date.toLocaleString(undefined, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function day(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

/** "2 min 49 s", "45 s", "1 h 05 min". */
export function span(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes} min ${total % 60} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

function minutes(seconds: number) {
  const value = Math.max(1, Math.round(seconds / 60));
  return `${value} min`;
}

export function megabytes(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** The analysis the tab draws: the one Smart Mix uses, else the latest. */
export function shownAnalysis(analyses: SmartMixTrackStemAnalysis[]) {
  const chosen = analyses.find((analysis) => analysis.chosen);
  if (chosen) return chosen;
  return [...analyses].sort(
    (a, b) =>
      Number(b.current) - Number(a.current) ||
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  )[0];
}

function jobDetail(job: SmartMixTrackStemJob, now: number) {
  const attempts = `${job.attempts} of ${job.maxAttempts} attempts`;
  if (job.state === "ready") {
    const took =
      job.startedAt && job.finishedAt
        ? (Date.parse(job.finishedAt) - Date.parse(job.startedAt)) / 1000
        : null;
    return [
      attempts,
      took != null ? span(took) : null,
      dateTime(job.finishedAt, false),
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (job.state === "failed") {
    return `${attempts} · last ${dateTime(job.finishedAt, false)}`;
  }
  if (job.state === "analyzing") {
    const elapsed = job.startedAt
      ? (now - Date.parse(job.startedAt)) / 1000
      : 0;
    const left = job.secondsPerTrack - elapsed;
    return [
      `attempt ${Math.max(1, job.attempts)} of ${job.maxAttempts}`,
      job.startedAt ? `started ${minutes(elapsed)} ago` : null,
      left > 0 ? `about ${minutes(left)} left` : "finishing",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return [
    job.requestedAt ? `queued ${dateTime(job.requestedAt, false)}` : "queued",
    job.attempts ? attempts : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function buildStemsTabModel(
  data: SmartMixTrackStems,
  { canManage, now = Date.now() }: { canManage: boolean; now?: number },
): StemsTabModel {
  const shown = shownAnalysis(data.analyses);
  const fileChangedAt = day(data.sourceStaleAt ?? data.profileAnalyzedAt);
  const analysis = shown
    ? {
        kind: shown.producerKind,
        producer: shown.producer,
        contributedBy: shown.contributedBy
          ? (shown.contributedBy.username ?? `user ${shown.contributedBy.id}`)
          : null,
        separatorModel: shown.separatorModel,
        separatorVersion: shown.separatorVersion,
        sourceRevision: shown.sourceRevision,
        current: shown.current,
        fileChangedAt: shown.current ? null : fileChangedAt,
        analysedAt: dateTime(shown.updatedAt),
        levels: Object.fromEntries(
          STEMS.map((stem) => [stem, decodeLevels(shown.levels[stem])]),
        ) as Record<StemName, number[]>,
        hopMs: shown.hopMs,
        drumBeatsMs: shown.drumBeatsMs,
      }
    : null;
  const job = data.job;
  const layer = analysis?.current ? (data.stems?.phrases ?? null) : null;

  let layerNote: string | null = null;
  if (analysis && !analysis.current) {
    layerNote = `This analysis is of the file the track had before ${
      analysis.fileChangedAt ?? "its last change"
    }: the planner ignores it and the track has no stems layer until the server separates the current file.`;
  } else if (analysis && !layer) {
    layerNote =
      "Level of each stem every 250 ms, from −60 to 0 dBFS. No stems layer: the track's profile has no phrases this analysis matches. Right: the track's mean.";
  } else if (!analysis && job?.state === "analyzing") {
    layerNote =
      "The server is separating this track for a Smart Mix playlist. Its levels and stems layer appear here when it ends.";
  } else if (!analysis && job?.state === "pending") {
    layerNote =
      "This track waits to be separated for a Smart Mix playlist. Its levels and stems layer appear here when the server separates it.";
  } else if (!analysis && job?.state === "failed") {
    layerNote =
      "The server could not separate this track, so it has no levels and no stems layer.";
  }

  const file = data.file;
  let files: StemsTabModel["files"];
  if (file?.current) {
    files = {
      stored: true,
      size: megabytes(file.bytes),
      streams: STEM_STREAMS,
      lastUsed: dateTime(file.lastUsedAt),
    };
  } else if (file) {
    files = {
      stored: false,
      note: "the stored file is of an earlier revision; the quota releases it",
    };
  } else if (job?.state === "analyzing" || job?.state === "pending") {
    files = { stored: false, note: "written when the separation ends" };
  } else if (analysis && !analysis.current && analysis.kind === "server") {
    files = {
      stored: false,
      note: "the file of the old revision was released to the quota",
    };
  } else if (analysis?.kind === "decks" && !job) {
    files = { stored: false, note: "Decks keeps its own lossless sidecar" };
  } else if (job?.state === "failed") {
    files = { stored: false, note: "no separation of this file ended" };
  } else {
    files = { stored: false, note: "released to the quota, or never kept" };
  }

  return {
    canManage,
    durationMs:
      data.durationMs ??
      (analysis ? analysis.levels.drums.length * analysis.hopMs : 0),
    phrases: data.phrases,
    voiceDetector: data.vocalDetector,
    analysis,
    layer,
    layerNote,
    files,
    playlists: data.playlists.map((playlist) => ({
      id: playlist.playlistId,
      name: playlist.name,
      owner:
        playlist.owner?.username ??
        (playlist.owner ? `user ${playlist.owner.id}` : "—"),
      enabled: playlist.enabled,
      ready: playlist.ready,
      total: playlist.total,
    })),
    job: job
      ? {
          state: job.state,
          attempts: job.attempts,
          detail: jobDetail(job, now),
          lastError: canManage ? job.lastError : null,
        }
      : null,
  };
}
