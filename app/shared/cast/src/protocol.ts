export const CAST_PROTOCOL_VERSION = 1 as const;
export const CAST_PROTOCOL_NAMESPACE =
  "urn:x-cast:app.cratemusic.crate.v1" as const;

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

export interface CastQueueItem {
  itemId: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  contentType: string;
  streamUrl: string;
  metadataUrl: string;
  spectrumUrl?: string;
  duration?: number;
  quality?: string;
}

export interface CastQueueSnapshot {
  revision: number;
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
  expectedRevision: number;
  queue: CastQueueSnapshot;
}

export interface CastQueueMutationMessage extends CastSessionMessageBase {
  type: "queue.mutate";
  mutationId: string;
  expectedRevision: number;
  operation: CastQueueOperation;
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
  revision: number;
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
  | CastQueueMutationMessage
  | CastQueueReplaceMessage
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function isRepeatMode(value: unknown): value is CastRepeatMode {
  return value === "all" || value === "off" || value === "one";
}

function parseQueueItem(value: unknown): CastQueueItem | null {
  if (!isRecord(value)) return null;
  if (
    !isNonEmptyString(value.itemId) ||
    !isNonEmptyString(value.title) ||
    !isNonEmptyString(value.artist) ||
    !isNonEmptyString(value.contentType) ||
    !isNonEmptyString(value.streamUrl) ||
    !isNonEmptyString(value.metadataUrl) ||
    !isOptionalString(value.album) ||
    !isOptionalString(value.artworkUrl) ||
    !isOptionalString(value.spectrumUrl) ||
    !isOptionalString(value.quality) ||
    (value.duration !== undefined && !isNonNegativeNumber(value.duration))
  ) {
    return null;
  }
  return {
    itemId: value.itemId,
    title: value.title,
    artist: value.artist,
    contentType: value.contentType,
    streamUrl: value.streamUrl,
    metadataUrl: value.metadataUrl,
    ...(value.album === undefined ? {} : { album: value.album }),
    ...(value.artworkUrl === undefined ? {} : { artworkUrl: value.artworkUrl }),
    ...(value.spectrumUrl === undefined
      ? {}
      : { spectrumUrl: value.spectrumUrl }),
    ...(value.duration === undefined ? {} : { duration: value.duration }),
    ...(value.quality === undefined ? {} : { quality: value.quality }),
  };
}

function parseQueueSnapshot(value: unknown): CastQueueSnapshot | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const items = value.items.map(parseQueueItem);
  if (
    items.some((item) => item === null) ||
    !isNonNegativeInteger(value.revision) ||
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
    revision: value.revision,
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
    !isNonEmptyString(value.skinId) ||
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
  if (!isRecord(value) || !isNonEmptyString(value.type)) return null;
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
      return isNonEmptyString(value.itemId) &&
        isNonNegativeInteger(value.toIndex)
        ? { type: value.type, itemId: value.itemId, toIndex: value.toIndex }
        : null;
    case "queue.remove":
      return isNonEmptyString(value.itemId)
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
    !isOptionalString(value.itemId) ||
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

function hasSessionEnvelope(
  value: Record<string, unknown>,
): value is Record<string, unknown> & { sessionId: string } {
  return isNonEmptyString(value.sessionId);
}

export function parseCastProtocolMessage(
  value: unknown,
): CastProtocolParseResult {
  if (!isRecord(value) || !isNonEmptyString(value.type)) {
    return { ok: false, error: "INVALID_MESSAGE" };
  }
  if (value.version !== CAST_PROTOCOL_VERSION) {
    return { ok: false, error: "UNSUPPORTED_VERSION" };
  }

  if (value.type === "receiver.ready") {
    const capabilities = value.capabilities;
    if (
      capabilities !== undefined &&
      (!Array.isArray(capabilities) ||
        capabilities.some((capability) => !isNonEmptyString(capability)))
    ) {
      return { ok: false, error: "INVALID_MESSAGE" };
    }
    return {
      ok: true,
      value: {
        version: 1,
        type: value.type,
        ...(capabilities === undefined
          ? {}
          : { capabilities: [...capabilities] as string[] }),
      },
    };
  }

  const knownSessionType = [
    "appearance.update",
    "queue.mutate",
    "queue.replace",
    "receiver.status",
    "session.stop",
  ].includes(value.type);
  if (!knownSessionType) {
    return { ok: false, error: "UNKNOWN_MESSAGE_TYPE" };
  }
  if (!hasSessionEnvelope(value)) {
    return { ok: false, error: "INVALID_MESSAGE" };
  }
  const base = {
    version: CAST_PROTOCOL_VERSION,
    sessionId: value.sessionId,
  };

  if (value.type === "appearance.update") {
    const appearance = parseAppearance(value.appearance);
    return appearance
      ? {
          ok: true,
          value: { ...base, type: value.type, appearance },
        }
      : { ok: false, error: "INVALID_MESSAGE" };
  }

  if (value.type === "queue.replace") {
    const queue = parseQueueSnapshot(value.queue);
    if (
      !queue ||
      !isNonEmptyString(value.mutationId) ||
      !isNonNegativeInteger(value.expectedRevision)
    ) {
      return { ok: false, error: "INVALID_MESSAGE" };
    }
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        mutationId: value.mutationId,
        expectedRevision: value.expectedRevision,
        queue,
      },
    };
  }

  if (value.type === "queue.mutate") {
    const operation = parseQueueOperation(value.operation);
    if (
      !operation ||
      !isNonEmptyString(value.mutationId) ||
      !isNonNegativeInteger(value.expectedRevision)
    ) {
      return { ok: false, error: "INVALID_MESSAGE" };
    }
    return {
      ok: true,
      value: {
        ...base,
        type: value.type,
        mutationId: value.mutationId,
        expectedRevision: value.expectedRevision,
        operation,
      },
    };
  }

  if (value.type === "receiver.status") {
    const error = parseReceiverError(value.error);
    if (
      error === null ||
      !isNonNegativeInteger(value.revision) ||
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
        revision: value.revision,
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

export function redactCastProtocolValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCastProtocolValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (SECRET_KEY.test(key)) return [key, "[REDACTED]"];
      if (URL_KEY.test(key) && typeof entry === "string") {
        return [key, entry.split(/[?#]/, 1)[0]];
      }
      return [key, redactCastProtocolValue(entry)];
    }),
  );
}
