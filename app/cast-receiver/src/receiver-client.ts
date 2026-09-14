import type {
  CastAppearance,
  CastQueueItem,
  CastQueueSnapshot,
} from "@crate/cast-protocol";

interface ReceiverSession {
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
  const resources =
    contentType && streamUrl && metadataUrl
      ? { contentType, streamUrl, metadataUrl, artworkUrl }
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
  return {
    contractVersion: 1,
    skinId: stringValue(appearance?.skinId, "default"),
    preferredMode:
      appearance?.preferredMode === "dark" ||
      appearance?.preferredMode === "light"
        ? appearance.preferredMode
        : "system",
    resolvedMode: appearance?.resolvedMode === "light" ? "light" : "dark",
    reducedMotion: appearance?.reducedMotion === true,
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
