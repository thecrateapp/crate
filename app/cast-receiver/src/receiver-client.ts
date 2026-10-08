import type {
  CastAppearance,
  CastQueueItem,
  CastQueueSnapshot,
} from "@crate/cast-protocol";

export interface ReceiverSession {
  appearance: CastAppearance;
  queue: CastQueueSnapshot;
  sessionId: string;
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function mapItem(value: unknown): CastQueueItem | null {
  const item = record(value);
  if (!item) return null;
  const itemId = stringValue(item.item_id);
  const title = stringValue(item.title);
  const artist = stringValue(item.artist);
  if (!itemId || !title || !artist) return null;
  const trackId = typeof item.track_id === "number" ? item.track_id : undefined;
  const trackEntityUid = optionalString(item.track_entity_uid);
  const trackPath = optionalString(item.track_path);
  const contentType = optionalString(item.content_type);
  const streamUrl = optionalString(item.stream_url);
  const metadataUrl = optionalString(item.metadata_url);
  const artworkUrl = optionalString(item.artwork_url);
  const spectrumUrl = optionalString(item.spectrum_url);
  const resources =
    contentType && streamUrl && metadataUrl
      ? { contentType, streamUrl, metadataUrl, artworkUrl, spectrumUrl }
      : undefined;
  return {
    itemId,
    track: { trackId, trackEntityUid, trackPath },
    title,
    artist,
    album: optionalString(item.album),
    duration:
      typeof item.duration === "number"
        ? finiteNumber(item.duration)
        : undefined,
    quality: optionalString(item.quality),
    resources,
  };
}

function mapAppearance(value: unknown): CastAppearance {
  const appearance = record(value);
  const skinId = appearance?.skinId ?? appearance?.skin_id;
  const preferredMode = appearance?.preferredMode ?? appearance?.preferred_mode;
  const resolvedMode = appearance?.resolvedMode ?? appearance?.resolved_mode;
  const reducedMotion = appearance?.reducedMotion ?? appearance?.reduced_motion;
  return {
    contractVersion: 1,
    skinId: stringValue(skinId, "default"),
    preferredMode:
      preferredMode === "dark" || preferredMode === "light"
        ? preferredMode
        : "system",
    resolvedMode: resolvedMode === "light" ? "light" : "dark",
    reducedMotion: reducedMotion === true,
  };
}

function mapSession(
  value: unknown,
  expectedSessionId: string,
): ReceiverSession | null {
  const session = record(value);
  const queue = record(session?.queue);
  if (
    session?.session_id !== expectedSessionId ||
    session.protocol_version !== 1 ||
    !queue ||
    !Array.isArray(queue.items)
  ) {
    return null;
  }
  const items = queue.items.map(mapItem);
  if (items.some((item) => item === null)) return null;
  const currentIndex = Math.min(
    Math.floor(finiteNumber(queue.current_index)),
    Math.max(items.length - 1, 0),
  );
  const repeatMode =
    queue.repeat_mode === "all" || queue.repeat_mode === "one"
      ? queue.repeat_mode
      : "off";
  return {
    sessionId: expectedSessionId,
    appearance: mapAppearance(session.appearance),
    queue: {
      queueRevision: Math.floor(finiteNumber(queue.revision)),
      stateSeq: Math.floor(finiteNumber(queue.state_seq)),
      currentIndex,
      currentTime: finiteNumber(queue.current_time),
      repeatMode,
      shuffle: queue.shuffle === true,
      items: items as CastQueueItem[],
    },
  };
}

export async function loadReceiverSession(
  bootstrapUrl: string,
  expectedSessionId: string,
  fetcher: Fetcher = fetch,
): Promise<ReceiverSession> {
  let response: Response;
  try {
    response = await fetcher(bootstrapUrl, {
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
    });
  } catch {
    throw new Error("CAST_SESSION_UNAVAILABLE");
  }
  if (!response.ok) throw new Error("CAST_SESSION_UNAVAILABLE");
  const session = mapSession(await response.json(), expectedSessionId);
  if (!session) throw new Error("CAST_SESSION_INVALID");
  return session;
}

export interface ReceiverStateUpdate {
  stateSeq: number;
  currentIndex: number;
  currentTime: number;
}

export interface PlayCheckpoint {
  clientEventId: string;
  itemId: string;
  startedAt: string;
  endedAt: string;
  playedSeconds: number;
  trackDurationSeconds?: number;
  completionRatio?: number;
  wasSkipped: boolean;
  wasCompleted: boolean;
}

async function postReceiverPayload(
  url: string,
  payload: unknown,
  fetcher: Fetcher,
): Promise<void> {
  const response = await fetcher(url, {
    method: "POST",
    cache: "no-store",
    credentials: "omit",
    mode: "cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("CAST_SESSION_UPDATE_FAILED");
}

export function publishReceiverState(
  bootstrapUrl: string,
  update: ReceiverStateUpdate,
  fetcher: Fetcher = fetch,
): Promise<void> {
  return postReceiverPayload(
    `${bootstrapUrl}/state`,
    {
      state_seq: update.stateSeq,
      current_index: update.currentIndex,
      current_time: update.currentTime,
    },
    fetcher,
  );
}

export function publishPlayCheckpoint(
  bootstrapUrl: string,
  checkpoint: PlayCheckpoint,
  fetcher: Fetcher = fetch,
): Promise<void> {
  return postReceiverPayload(
    `${bootstrapUrl}/checkpoints`,
    {
      client_event_id: checkpoint.clientEventId,
      item_id: checkpoint.itemId,
      started_at: checkpoint.startedAt,
      ended_at: checkpoint.endedAt,
      played_seconds: checkpoint.playedSeconds,
      track_duration_seconds: checkpoint.trackDurationSeconds,
      completion_ratio: checkpoint.completionRatio,
      was_skipped: checkpoint.wasSkipped,
      was_completed: checkpoint.wasCompleted,
    },
    fetcher,
  );
}
