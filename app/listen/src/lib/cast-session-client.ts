import type { CastAppearance } from "@crate/cast-protocol";

import type { Track } from "@/contexts/player-types";
import { api } from "@/lib/api";
import { DEFAULT_RECEIVER_CAPABILITIES } from "./cast-sender-media";
import type {
  CastPlaybackSessionResponse,
  CastSessionQueueItemResponse,
  CastStartPayload,
} from "./cast-sender-types";

export interface CastSessionQueueItemRequest {
  item_id: string;
  track_id?: number;
  track_entity_uid?: string;
  track_path?: string;
}

export interface CastSessionQueueUpdateRequest {
  expected_revision: number;
  mutation_id: string;
  items: CastSessionQueueItemRequest[];
  repeat_mode?: "all" | "off" | "one";
  shuffle?: boolean;
}

export interface CastSessionQueueUpdateResponse {
  mutation_status: "applied" | "duplicate";
  queue: CastPlaybackSessionResponse["queue"];
  session_id: string;
}

export interface ScopedCastPlaybackSessionResponse {
  appearance: Record<string, unknown>;
  protocol_version: 1;
  queue: CastPlaybackSessionResponse["queue"];
  session_id: string;
}

interface CastSessionCreateRequest {
  protocol_version: 1;
  target_device_id?: string;
  receiver_capabilities: Record<string, unknown>;
  appearance: {
    contract_version: 1;
    skin_id: string;
    preferred_mode: "dark" | "light" | "system";
    resolved_mode: "dark" | "light";
    reduced_motion: boolean;
  };
  current_index: number;
  current_time: number;
  repeat_mode: "all" | "off" | "one";
  shuffle: boolean;
  revision: 0;
  items: CastSessionQueueItemRequest[];
}

const DEFAULT_APPEARANCE: CastAppearance = {
  contractVersion: 1,
  skinId: "default",
  preferredMode: "system",
  resolvedMode: "dark",
  reducedMotion: false,
};

function receiverSkinId(skinId: string): string {
  return skinId === "crateRed" || skinId === "crate-red"
    ? "crate-red"
    : "default";
}

function hashPath(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function itemIdentity(track: Track): string {
  if (typeof track.libraryTrackId === "number" && track.libraryTrackId > 0) {
    return `track-${track.libraryTrackId}`;
  }
  if (track.entityUid) return `entity-${track.entityUid}`;
  if (track.path) return `path-${hashPath(track.path)}`;
  throw new Error("CAST_QUEUE_REFERENCE_MISSING");
}

function responseItemIdentity(item: CastSessionQueueItemResponse): string {
  if (typeof item.track_id === "number" && item.track_id > 0) {
    return `track-${item.track_id}`;
  }
  if (item.track_entity_uid) return `entity-${item.track_entity_uid}`;
  if (item.track_path) return `path-${hashPath(item.track_path)}`;
  throw new Error("CAST_QUEUE_REFERENCE_MISSING");
}

function queueItem(
  track: Track,
  occurrence: number,
): CastSessionQueueItemRequest {
  const stableId = itemIdentity(track);
  const item: CastSessionQueueItemRequest = {
    item_id: `${stableId}-${occurrence}`.slice(0, 160),
  };
  if (typeof track.libraryTrackId === "number" && track.libraryTrackId > 0) {
    item.track_id = track.libraryTrackId;
  } else if (track.entityUid) {
    item.track_entity_uid = track.entityUid;
  } else if (track.path) {
    item.track_path = track.path;
  }
  return item;
}

function queueItems(
  queue: Track[],
  previous: CastSessionQueueItemResponse[] = [],
): CastSessionQueueItemRequest[] {
  const previousByIdentity = new Map<string, CastSessionQueueItemResponse[]>();
  const usedItemIds = new Set(previous.map((item) => item.item_id));
  for (const item of previous) {
    const identity = responseItemIdentity(item);
    const bucket = previousByIdentity.get(identity) ?? [];
    bucket.push(item);
    previousByIdentity.set(identity, bucket);
  }
  const occurrences = new Map<string, number>();
  return queue.map((track) => {
    const identity = itemIdentity(track);
    const preserved = previousByIdentity.get(identity)?.shift();
    if (preserved) {
      const item = queueItem(track, 1);
      item.item_id = preserved.item_id;
      return item;
    }
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    let availableOccurrence = occurrence;
    let item = queueItem(track, availableOccurrence);
    while (usedItemIds.has(item.item_id)) {
      availableOccurrence += 1;
      item = queueItem(track, availableOccurrence);
    }
    occurrences.set(identity, availableOccurrence);
    usedItemIds.add(item.item_id);
    return item;
  });
}

export function buildCastQueueUpdateRequest(
  queue: Track[],
  previous: CastSessionQueueItemResponse[],
  expectedRevision: number,
  mutationId: string,
  repeatMode?: "all" | "off" | "one",
  shuffle?: boolean,
): CastSessionQueueUpdateRequest {
  return {
    expected_revision: expectedRevision,
    mutation_id: mutationId,
    ...(repeatMode === undefined ? {} : { repeat_mode: repeatMode }),
    ...(shuffle === undefined ? {} : { shuffle }),
    items: queueItems(queue, previous),
  };
}

export function buildCastSessionRequest(
  payload: CastStartPayload,
): CastSessionCreateRequest {
  const queue = payload.queue?.length ? payload.queue : [payload.track];
  const requestedIndex = payload.currentIndex ?? queue.indexOf(payload.track);
  const currentIndex = Math.max(
    0,
    Math.min(requestedIndex < 0 ? 0 : requestedIndex, queue.length - 1),
  );
  const appearance = payload.appearance ?? DEFAULT_APPEARANCE;
  return {
    protocol_version: 1,
    ...(payload.targetDeviceId
      ? { target_device_id: payload.targetDeviceId }
      : {}),
    receiver_capabilities: DEFAULT_RECEIVER_CAPABILITIES,
    appearance: {
      contract_version: 1,
      skin_id: receiverSkinId(appearance.skinId),
      preferred_mode: appearance.preferredMode,
      resolved_mode: appearance.resolvedMode,
      reduced_motion: appearance.reducedMotion,
    },
    current_index: currentIndex,
    current_time: Math.max(0, payload.currentTime ?? 0),
    repeat_mode: payload.repeatMode ?? "off",
    shuffle: payload.shuffle === true,
    revision: 0,
    items: queueItems(queue),
  };
}

export function createCastPlaybackSession(
  payload: CastStartPayload,
): Promise<CastPlaybackSessionResponse> {
  return api<CastPlaybackSessionResponse>(
    "/api/me/cast/sessions",
    "POST",
    buildCastSessionRequest(payload),
  );
}

export function revokeCastPlaybackSession(sessionId: string): Promise<unknown> {
  return api(
    `/api/me/cast/sessions/${encodeURIComponent(sessionId)}`,
    "DELETE",
  );
}

export function updateCastPlaybackSession(
  sessionId: string,
  request: CastSessionQueueUpdateRequest,
): Promise<CastSessionQueueUpdateResponse> {
  return api<CastSessionQueueUpdateResponse>(
    `/api/me/cast/sessions/${encodeURIComponent(sessionId)}`,
    "PATCH",
    request,
  );
}

export async function loadScopedCastPlaybackSession(
  bootstrapUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<ScopedCastPlaybackSessionResponse> {
  const response = await fetcher(bootstrapUrl, {
    cache: "no-store",
    credentials: "omit",
    mode: "cors",
  });
  if (!response.ok) throw new Error("CAST_SESSION_UNAVAILABLE");
  const value = (await response.json()) as ScopedCastPlaybackSessionResponse;
  if (
    value.protocol_version !== 1 ||
    !value.session_id ||
    !value.queue ||
    !Array.isArray(value.queue.items)
  ) {
    throw new Error("CAST_SESSION_INVALID");
  }
  return value;
}
