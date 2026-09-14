export const CAST_PROTOCOL_VERSION = 1 as const;
export const CAST_PROTOCOL_NAMESPACE =
  "urn:x-cast:app.cratemusic.crate.v1" as const;
export const MAX_CAST_QUEUE_ITEMS = 1_000;

const MAX_ID_LENGTH = 160;
const MAX_TEXT_LENGTH = 512;
const MAX_URL_LENGTH = 4_096;
const MAX_CAPABILITIES = 32;

export type CastPreferredMode = "dark" | "light" | "system";
export type CastResolvedMode = "dark" | "light";
export type CastRepeatMode = "all" | "off" | "one";
export type CastPlayerState =
  | "BUFFERING"
  | "IDLE"
  | "PAUSED"
  | "PLAYING"
  | "RECOVERING";

export interface CastAppearance {
  contractVersion: 1;
  skinId: string;
  preferredMode: CastPreferredMode;
  resolvedMode: CastResolvedMode;
  reducedMotion: boolean;
  artworkPalette?: string[];
}

export interface CastTrackReference {
  trackId?: number;
  trackEntityUid?: string;
  trackPath?: string;
}

export interface CastQueueItemResources {
  contentType: string;
  streamUrl: string;
  metadataUrl: string;
  artworkUrl?: string;
  spectrumUrl?: string;
}

export interface CastQueueItem {
  itemId: string;
  track: CastTrackReference;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  quality?: string;
  resources?: CastQueueItemResources;
}

export interface CastQueueSnapshot {
  queueRevision: number;
  stateSeq: number;
  currentIndex: number;
  currentTime: number;
  repeatMode: CastRepeatMode;
  shuffle: boolean;
  items: CastQueueItem[];
}

export type CastQueueOperation =
  | { type: "queue.clear" }
  | { type: "queue.insert"; index: number; item: CastQueueItem }
  | { type: "queue.move"; itemId: string; toIndex: number }
  | { type: "queue.remove"; itemId: string }
  | { type: "queue.set-repeat"; repeatMode: CastRepeatMode }
  | { type: "queue.set-shuffle"; shuffle: boolean };

interface CastMessageBase {
  version: typeof CAST_PROTOCOL_VERSION;
  messageId: string;
  replyTo?: string;
  type: string;
}

interface CastSessionMessageBase extends CastMessageBase {
  sessionId: string;
}

export interface CastReceiverReadyMessage extends CastMessageBase {
  type: "receiver.ready";
  capabilities?: string[];
}

export interface CastQueueReplaceMessage extends CastSessionMessageBase {
  type: "queue.replace";
  mutationId: string;
  expectedQueueRevision: number;
  queue: CastQueueSnapshot;
}

export interface CastQueueMutationMessage extends CastSessionMessageBase {
  type: "queue.mutate";
  mutationId: string;
  expectedQueueRevision: number;
  operation: CastQueueOperation;
}

export interface CastQueueAcknowledgementMessage
  extends CastSessionMessageBase {
  type: "queue.ack";
  mutationId: string;
  queueRevision: number;
  stateSeq: number;
}

export interface CastQueueSnapshotMessage extends CastSessionMessageBase {
  type: "queue.snapshot";
  reason: "conflict" | "reconnect" | "requested" | "updated";
  queue: CastQueueSnapshot;
}

export interface CastAppearanceUpdateMessage extends CastSessionMessageBase {
  type: "appearance.update";
  appearance: CastAppearance;
}

export type CastReceiverErrorCode =
  | "LEASE_EXPIRED"
  | "MEDIA_FAILED"
  | "MEDIA_RETRYING"
  | "PROTOCOL_MISMATCH"
  | "QUEUE_CONFLICT"
  | "SPECTRUM_UNAVAILABLE";

export interface CastReceiverError {
  code: CastReceiverErrorCode;
  recoverable: boolean;
  itemId?: string;
  attempt?: number;
}

export interface CastReceiverStatusMessage extends CastSessionMessageBase {
  type: "receiver.status";
  queueRevision: number;
  stateSeq: number;
  currentIndex: number;
  currentTime: number;
  playerState: CastPlayerState;
  consecutiveFailures: number;
  error?: CastReceiverError;
}

export interface CastSessionStopMessage extends CastSessionMessageBase {
  type: "session.stop";
  reason?: "ended" | "error" | "user";
}

export type CastProtocolMessage =
  | CastAppearanceUpdateMessage
  | CastQueueAcknowledgementMessage
  | CastQueueMutationMessage
  | CastQueueReplaceMessage
  | CastQueueSnapshotMessage
  | CastReceiverReadyMessage
  | CastReceiverStatusMessage
  | CastSessionStopMessage;

export type CastProtocolParseError =
  | "INVALID_MESSAGE"
  | "UNKNOWN_MESSAGE_TYPE"
  | "UNSUPPORTED_VERSION";

export type CastProtocolParseResult =
  | { ok: true; value: CastProtocolMessage }
  | { ok: false; error: CastProtocolParseError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function isOptionalBoundedString(
  value: unknown,
  maxLength: number,
): value is string | undefined {
  return value === undefined || isBoundedString(value, maxLength);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRepeatMode(value: unknown): value is CastRepeatMode {
  return value === "all" || value === "off" || value === "one";
}

function parseTrackReference(value: unknown): CastTrackReference | null {
  if (!isRecord(value)) return null;
  const trackId = value.trackId;
  const trackEntityUid = value.trackEntityUid;
  const trackPath = value.trackPath;
  if (
    (trackId !== undefined && !isPositiveInteger(trackId)) ||
    !isOptionalBoundedString(trackEntityUid, MAX_ID_LENGTH) ||
    !isOptionalBoundedString(trackPath, 2_048) ||
    (trackId === undefined &&
      trackEntityUid === undefined &&
      trackPath === undefined)
  ) {
    return null;
  }
  return {
    ...(trackId === undefined ? {} : { trackId }),
    ...(trackEntityUid === undefined ? {} : { trackEntityUid }),
    ...(trackPath === undefined ? {} : { trackPath }),
  };
}

function parseResources(value: unknown): CastQueueItemResources | null {
  if (!isRecord(value)) return null;
  if (
    !isBoundedString(value.contentType, MAX_TEXT_LENGTH) ||
    !isBoundedString(value.streamUrl, MAX_URL_LENGTH) ||
    !isBoundedString(value.metadataUrl, MAX_URL_LENGTH) ||
    !isOptionalBoundedString(value.artworkUrl, MAX_URL_LENGTH) ||
    !isOptionalBoundedString(value.spectrumUrl, MAX_URL_LENGTH)
  ) {
    return null;
  }
  return {
    contentType: value.contentType,
    streamUrl: value.streamUrl,
    metadataUrl: value.metadataUrl,
    ...(value.artworkUrl === undefined ? {} : { artworkUrl: value.artworkUrl }),
    ...(value.spectrumUrl === undefined
      ? {}
      : { spectrumUrl: value.spectrumUrl }),
  };
}

function parseQueueItem(value: unknown): CastQueueItem | null {
  if (!isRecord(value)) return null;
  const track = parseTrackReference(value.track);
  const resources =
    value.resources === undefined ? undefined : parseResources(value.resources);
  if (
    !track ||
    resources === null ||
    !isBoundedString(value.itemId, MAX_ID_LENGTH) ||
    !isBoundedString(value.title, MAX_TEXT_LENGTH) ||
    !isBoundedString(value.artist, MAX_TEXT_LENGTH) ||
    !isOptionalBoundedString(value.album, MAX_TEXT_LENGTH) ||
    !isOptionalBoundedString(value.quality, MAX_TEXT_LENGTH) ||
    (value.duration !== undefined && !isNonNegativeNumber(value.duration))
  ) {
    return null;
  }
  return {
    itemId: value.itemId,
    track,
    title: value.title,
    artist: value.artist,
    ...(value.album === undefined ? {} : { album: value.album }),
    ...(value.duration === undefined ? {} : { duration: value.duration }),
    ...(value.quality === undefined ? {} : { quality: value.quality }),
    ...(resources === undefined ? {} : { resources }),
  };
}

function parseQueueSnapshot(value: unknown): CastQueueSnapshot | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    value.items.length > MAX_CAST_QUEUE_ITEMS
  ) {
    return null;
  }
  const items = value.items.map(parseQueueItem);
  const itemIds = items.map((item) => item?.itemId);
  if (
    items.some((item) => item === null) ||
    new Set(itemIds).size !== itemIds.length ||
    !isNonNegativeInteger(value.queueRevision) ||
    !isNonNegativeInteger(value.stateSeq) ||
    !isNonNegativeInteger(value.currentIndex) ||
    !isNonNegativeNumber(value.currentTime) ||
    !isRepeatMode(value.repeatMode) ||
    typeof value.shuffle !== "boolean" ||
    (items.length === 0 && value.currentIndex !== 0) ||
    (items.length > 0 && value.currentIndex >= items.length)
  ) {
    return null;
  }
  return {
    queueRevision: value.queueRevision,
    stateSeq: value.stateSeq,
    currentIndex: value.currentIndex,
    currentTime: value.currentTime,
    repeatMode: value.repeatMode,
    shuffle: value.shuffle,
    items: items as CastQueueItem[],
  };
}

function parseAppearance(value: unknown): CastAppearance | null {
  if (!isRecord(value)) return null;
  const palette = value.artworkPalette;
  if (
    value.contractVersion !== 1 ||
    !isBoundedString(value.skinId, MAX_ID_LENGTH) ||
    !["dark", "light", "system"].includes(String(value.preferredMode)) ||
    !["dark", "light"].includes(String(value.resolvedMode)) ||
    typeof value.reducedMotion !== "boolean" ||
    (palette !== undefined &&
      (!Array.isArray(palette) ||
        palette.length > 5 ||
        palette.some(
          (colour) =>
            typeof colour !== "string" || !/^#[0-9a-f]{6}$/i.test(colour),
        )))
  ) {
    return null;
  }
  return {
    contractVersion: 1,
    skinId: value.skinId,
    preferredMode: value.preferredMode as CastPreferredMode,
    resolvedMode: value.resolvedMode as CastResolvedMode,
    reducedMotion: value.reducedMotion,
    ...(palette === undefined ? {} : { artworkPalette: [...palette] }),
  };
}

function parseQueueOperation(value: unknown): CastQueueOperation | null {
  if (!isRecord(value) || !isBoundedString(value.type, MAX_ID_LENGTH)) {
    return null;
  }
  switch (value.type) {
    case "queue.clear":
      return { type: value.type };
    case "queue.insert": {
      const item = parseQueueItem(value.item);
      return isNonNegativeInteger(value.index) && item
        ? { type: value.type, index: value.index, item }
        : null;
    }
    case "queue.move":
      return isBoundedString(value.itemId, MAX_ID_LENGTH) &&
        isNonNegativeInteger(value.toIndex)
        ? { type: value.type, itemId: value.itemId, toIndex: value.toIndex }
        : null;
    case "queue.remove":
      return isBoundedString(value.itemId, MAX_ID_LENGTH)
        ? { type: value.type, itemId: value.itemId }
        : null;
    case "queue.set-repeat":
      return isRepeatMode(value.repeatMode)
        ? { type: value.type, repeatMode: value.repeatMode }
        : null;
    case "queue.set-shuffle":
      return typeof value.shuffle === "boolean"
        ? { type: value.type, shuffle: value.shuffle }
        : null;
    default:
      return null;
  }
}

const PLAYER_STATES = new Set<CastPlayerState>([
  "BUFFERING",
  "IDLE",
  "PAUSED",
  "PLAYING",
  "RECOVERING",
]);

const ERROR_CODES = new Set<CastReceiverErrorCode>([
  "LEASE_EXPIRED",
  "MEDIA_FAILED",
  "MEDIA_RETRYING",
  "PROTOCOL_MISMATCH",
  "QUEUE_CONFLICT",
  "SPECTRUM_UNAVAILABLE",
]);

function parseReceiverError(
  value: unknown,
): CastReceiverError | undefined | null {
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    !ERROR_CODES.has(value.code as CastReceiverErrorCode) ||
    typeof value.recoverable !== "boolean" ||
    !isOptionalBoundedString(value.itemId, MAX_ID_LENGTH) ||
    (value.attempt !== undefined && !isNonNegativeInteger(value.attempt))
  ) {
    return null;
  }
  return {
    code: value.code as CastReceiverErrorCode,
    recoverable: value.recoverable,
    ...(value.itemId === undefined ? {} : { itemId: value.itemId }),
    ...(value.attempt === undefined ? {} : { attempt: value.attempt }),
  };
}

function parseEnvelope(value: Record<string, unknown>) {
  if (
    !isBoundedString(value.messageId, MAX_ID_LENGTH) ||
    !isOptionalBoundedString(value.replyTo, MAX_ID_LENGTH)
  ) {
    return null;
  }
  return {
    version: CAST_PROTOCOL_VERSION,
    messageId: value.messageId,
    ...(value.replyTo === undefined ? {} : { replyTo: value.replyTo }),
  };
}

function parseSessionEnvelope(value: Record<string, unknown>) {
  const envelope = parseEnvelope(value);
  if (!envelope || !isBoundedString(value.sessionId, MAX_ID_LENGTH)) {
    return null;
  }
  return { ...envelope, sessionId: value.sessionId };
}

export function parseCastProtocolMessage(
  value: unknown,
): CastProtocolParseResult {
  if (!isRecord(value) || !isBoundedString(value.type, MAX_ID_LENGTH)) {
    return { ok: false, error: "INVALID_MESSAGE" };
  }
  if (value.version !== CAST_PROTOCOL_VERSION) {
    return { ok: false, error: "UNSUPPORTED_VERSION" };
  }
  const envelope = parseEnvelope(value);
  if (!envelope) return { ok: false, error: "INVALID_MESSAGE" };

  if (value.type === "receiver.ready") {
    const capabilities = value.capabilities;
    if (
      capabilities !== undefined &&
      (!Array.isArray(capabilities) ||
        capabilities.length > MAX_CAPABILITIES ||
        capabilities.some(
          (capability) => !isBoundedString(capability, MAX_ID_LENGTH),
        ))
    ) {
      return { ok: false, error: "INVALID_MESSAGE" };
    }
    return {
      ok: true,
      value: {
        ...envelope,
        type: value.type,
        ...(capabilities === undefined
          ? {}
          : { capabilities: [...capabilities] as string[] }),
      },
    };
  }

  const knownSessionType = [
    "appearance.update",
    "queue.ack",
    "queue.mutate",
    "queue.replace",
    "queue.snapshot",
    "receiver.status",
    "session.stop",
  ].includes(value.type);
  if (!knownSessionType) {
    return { ok: false, error: "UNKNOWN_MESSAGE_TYPE" };
  }
  const base = parseSessionEnvelope(value);
  if (!base) return { ok: false, error: "INVALID_MESSAGE" };

  if (value.type === "appearance.update") {
    const appearance = parseAppearance(value.appearance);
    return appearance
      ? { ok: true, value: { ...base, type: value.type, appearance } }
      : { ok: false, error: "INVALID_MESSAGE" };
  }

  if (value.type === "queue.replace") {
    const queue = parseQueueSnapshot(value.queue);
    if (
      !queue ||
      !isBoundedString(value.mutationId, MAX_ID_LENGTH) ||
      !isNonNegativeInteger(value.expectedQueueRevision)
    ) {
      return { ok: false, error: "INVALID_MESSAGE" };
    }
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        mutationId: value.mutationId,
        expectedQueueRevision: value.expectedQueueRevision,
        queue,
      },
    };
  }

  if (value.type === "queue.mutate") {
    const operation = parseQueueOperation(value.operation);
    if (
      !operation ||
      !isBoundedString(value.mutationId, MAX_ID_LENGTH) ||
      !isNonNegativeInteger(value.expectedQueueRevision)
    ) {
      return { ok: false, error: "INVALID_MESSAGE" };
    }
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        mutationId: value.mutationId,
        expectedQueueRevision: value.expectedQueueRevision,
        operation,
      },
    };
  }

  if (value.type === "queue.ack") {
    if (
      !isBoundedString(value.mutationId, MAX_ID_LENGTH) ||
      !isNonNegativeInteger(value.queueRevision) ||
      !isNonNegativeInteger(value.stateSeq)
    ) {
      return { ok: false, error: "INVALID_MESSAGE" };
    }
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        mutationId: value.mutationId,
        queueRevision: value.queueRevision,
        stateSeq: value.stateSeq,
      },
    };
  }

  if (value.type === "queue.snapshot") {
    const queue = parseQueueSnapshot(value.queue);
    if (
      !queue ||
      !["conflict", "reconnect", "requested", "updated"].includes(
        String(value.reason),
      )
    ) {
      return { ok: false, error: "INVALID_MESSAGE" };
    }
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        reason: value.reason as CastQueueSnapshotMessage["reason"],
        queue,
      },
    };
  }

  if (value.type === "receiver.status") {
    const error = parseReceiverError(value.error);
    if (
      error === null ||
      !isNonNegativeInteger(value.queueRevision) ||
      !isNonNegativeInteger(value.stateSeq) ||
      !isNonNegativeInteger(value.currentIndex) ||
      !isNonNegativeNumber(value.currentTime) ||
      !PLAYER_STATES.has(value.playerState as CastPlayerState) ||
      !isNonNegativeInteger(value.consecutiveFailures)
    ) {
      return { ok: false, error: "INVALID_MESSAGE" };
    }
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        queueRevision: value.queueRevision,
        stateSeq: value.stateSeq,
        currentIndex: value.currentIndex,
        currentTime: value.currentTime,
        playerState: value.playerState as CastPlayerState,
        consecutiveFailures: value.consecutiveFailures,
        ...(error === undefined ? {} : { error }),
      },
    };
  }

  if (
    value.reason !== undefined &&
    !["ended", "error", "user"].includes(String(value.reason))
  ) {
    return { ok: false, error: "INVALID_MESSAGE" };
  }
  return {
    ok: true,
    value: {
      ...base,
      type: "session.stop",
      ...(value.reason === undefined
        ? {}
        : { reason: value.reason as CastSessionStopMessage["reason"] }),
    },
  };
}

const SECRET_KEY = /(authorization|lease|secret|ticket|token)/i;
const URL_KEY = /url$/i;
const SESSION_LEASE_PATH = /(\/api\/cast\/sessions\/)[^/?#]+/gi;

function redactUrl(value: string): string {
  const [path = ""] = value.split(/[?#]/, 1);
  return path.replace(SESSION_LEASE_PATH, "$1[REDACTED]");
}

export function redactCastProtocolValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCastProtocolValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (SECRET_KEY.test(key)) return [key, "[REDACTED]"];
      if (URL_KEY.test(key) && typeof entry === "string") {
        return [key, redactUrl(entry)];
      }
      return [key, redactCastProtocolValue(entry)];
    }),
  );
}
