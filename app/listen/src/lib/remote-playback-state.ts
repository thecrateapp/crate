import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import { api, apiFetch } from "@/lib/api";
import { isCrateConnectEnabled } from "@/lib/crate-connect";
import {
  getListenAppPlatform,
  getListenDeviceCapabilities,
  getListenDeviceId,
  getListenDeviceLabel,
  getListenDeviceType,
} from "@/lib/listen-device";

export interface ConnectDevicePayload {
  device_id: string;
  device_label: string;
  device_type: string;
  app_platform: string;
  capabilities: ReturnType<typeof getListenDeviceCapabilities>;
}

export interface PlaybackStatePayload {
  device_id: string;
  snapshot_kind: "light" | "structural";
  status: "playing" | "paused" | "stopped" | "buffering";
  claim_active?: boolean;
  track_id?: number;
  track_entity_uid?: string;
  track_path?: string;
  title: string;
  artist: string;
  album: string;
  album_cover?: string;
  position_ms: number;
  duration_ms?: number;
  current_index: number;
  queue_revision: string;
  queue?: CompactTrackReference[];
  play_source?: CompactPlaySource | null;
  repeat_mode: RepeatMode;
  shuffle: boolean;
  unshuffled_queue?: CompactTrackReference[] | null;
  playback_rate: number;
  app_platform: string;
  device_type: string;
}

export interface RemotePlaybackState {
  device_id: string;
  device_label?: string | null;
  status: string;
  track_id?: number | null;
  track_entity_uid?: string | null;
  track_path?: string | null;
  title: string;
  artist: string;
  album: string;
  album_cover?: string | null;
  position_ms: number;
  duration_ms?: number | null;
  current_index: number;
  queue_revision?: string | null;
  queue: CompactTrackReference[];
  play_source?: CompactPlaySource | null;
  repeat_mode: RepeatMode;
  shuffle: boolean;
  unshuffled_queue?: CompactTrackReference[] | null;
  app_platform?: string | null;
  device_type?: string | null;
  updated_at?: string | null;
  expires_at?: string | null;
}

export interface ResumeCandidateResponse {
  candidate: RemotePlaybackState | null;
}

export interface CompactTrackReference {
  track_id?: number;
  track_entity_uid?: string;
  path?: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  album_cover?: string;
}

export interface CompactPlaySource {
  type: PlaySource["type"];
  name: string;
  id?: string | number | null;
  radio?: PlaySource["radio"];
}

interface BuildPlaybackStateInput {
  queue: Track[];
  currentIndex: number;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  playSource: PlaySource | null;
  unshuffledQueue?: Track[] | null;
  snapshotKind: "light" | "structural";
  claimActive?: boolean;
}

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function numericTrackId(track: Track): number | undefined {
  if (typeof track.libraryTrackId === "number") return track.libraryTrackId;
  const parsed = Number(track.id);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function trackKey(track: Track): string {
  return (
    track.entityUid ||
    String(track.libraryTrackId || "") ||
    track.path ||
    track.id ||
    `${track.artist}:${track.title}`
  );
}

export function buildQueueRevision(
  queue: Track[],
  currentIndex: number,
  repeat: RepeatMode,
  shuffle: boolean,
  playSource: PlaySource | null,
): string {
  const sourceKey = playSource
    ? `${playSource.type}:${playSource.id ?? ""}:${playSource.name}`
    : "none";
  const signature = [
    queue.length,
    currentIndex,
    repeat,
    shuffle ? "shuffle" : "linear",
    sourceKey,
    queue.map(trackKey).join("|"),
  ].join("::");
  return hashString(signature);
}

export function compactTrackReference(track: Track): CompactTrackReference {
  const payload: CompactTrackReference = {
    title: track.title || "",
    artist: track.artist || "",
  };
  const trackId = numericTrackId(track);
  if (trackId) payload.track_id = trackId;
  if (track.entityUid) payload.track_entity_uid = track.entityUid;
  if (track.path) payload.path = track.path;
  if (track.album) payload.album = track.album;
  if (typeof track.duration === "number" && Number.isFinite(track.duration)) {
    payload.duration = track.duration;
  }
  if (track.albumCover) payload.album_cover = track.albumCover;
  return payload;
}

export function compactPlaySource(
  playSource: PlaySource | null,
): CompactPlaySource | null {
  if (!playSource) return null;
  return {
    type: playSource.type,
    name: playSource.name,
    id: playSource.id ?? null,
    radio: playSource.radio,
  };
}

export function getCurrentConnectDevice(): ConnectDevicePayload {
  const enabled = isCrateConnectEnabled();
  const capabilities = getListenDeviceCapabilities();
  return {
    device_id: getListenDeviceId(),
    device_label: getListenDeviceLabel(),
    device_type: getListenDeviceType(),
    app_platform: getListenAppPlatform(),
    capabilities: enabled
      ? capabilities
      : {
          ...capabilities,
          can_receive_commands: false,
        },
  };
}

export function buildPlaybackStatePayload({
  queue,
  currentIndex,
  currentTime,
  duration,
  isPlaying,
  repeat,
  shuffle,
  playSource,
  unshuffledQueue,
  snapshotKind,
  claimActive = false,
}: BuildPlaybackStateInput): PlaybackStatePayload {
  const device = getCurrentConnectDevice();
  const currentTrack =
    currentIndex >= 0 && currentIndex < queue.length
      ? queue[currentIndex]
      : undefined;
  const queueRevision = buildQueueRevision(
    queue,
    currentIndex,
    repeat,
    shuffle,
    playSource,
  );
  const durationSeconds =
    duration > 0
      ? duration
      : currentTrack?.duration && currentTrack.duration > 0
        ? currentTrack.duration
        : 0;
  const payload: PlaybackStatePayload = {
    device_id: device.device_id,
    snapshot_kind: snapshotKind,
    status: queue.length ? (isPlaying ? "playing" : "paused") : "stopped",
    claim_active: claimActive || undefined,
    track_id: currentTrack ? numericTrackId(currentTrack) : undefined,
    track_entity_uid: currentTrack?.entityUid,
    track_path: currentTrack?.path,
    title: currentTrack?.title || "",
    artist: currentTrack?.artist || "",
    album: currentTrack?.album || "",
    album_cover: currentTrack?.albumCover,
    position_ms: Math.max(0, Math.round(currentTime * 1000)),
    duration_ms: durationSeconds
      ? Math.round(durationSeconds * 1000)
      : undefined,
    current_index: Math.max(0, currentIndex),
    queue_revision: queueRevision,
    repeat_mode: repeat,
    shuffle,
    playback_rate: 1,
    app_platform: device.app_platform,
    device_type: device.device_type,
  };

  if (snapshotKind === "structural") {
    payload.queue = queue.map(compactTrackReference);
    payload.play_source = compactPlaySource(playSource);
    payload.unshuffled_queue = unshuffledQueue
      ? unshuffledQueue.map(compactTrackReference)
      : null;
  }

  return payload;
}

export async function registerCurrentConnectDevice(): Promise<void> {
  await api("/api/me/devices/current", "PUT", getCurrentConnectDevice());
}

export async function markCurrentConnectDevicePresent(): Promise<void> {
  await api(
    "/api/me/devices/current/presence",
    "POST",
    getCurrentConnectDevice(),
  );
}

export async function publishPlaybackState(
  payload: PlaybackStatePayload,
  options: { keepalive?: boolean } = {},
): Promise<void> {
  const response = await apiFetch("/api/me/playback-state/current", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: options.keepalive,
  });
  if (!response.ok) {
    throw new Error(`Playback checkpoint failed with HTTP ${response.status}`);
  }
}

export function fetchResumeCandidate(): Promise<ResumeCandidateResponse> {
  return api<ResumeCandidateResponse>(
    `/api/me/playback-state/resume?device_id=${encodeURIComponent(
      getListenDeviceId(),
    )}`,
  );
}

export function remoteTrackToPlayerTrack(
  track: CompactTrackReference,
  index = 0,
): Track {
  return {
    id:
      track.track_entity_uid ||
      (typeof track.track_id === "number" ? String(track.track_id) : "") ||
      track.path ||
      `remote-${index}`,
    entityUid: track.track_entity_uid,
    libraryTrackId: track.track_id,
    path: track.path,
    title: track.title || "Unknown track",
    artist: track.artist || "Unknown artist",
    album: track.album,
    albumCover: track.album_cover,
    duration:
      typeof track.duration === "number" && Number.isFinite(track.duration)
        ? track.duration
        : undefined,
  };
}

export function remotePlaybackQueue(state: RemotePlaybackState): Track[] {
  if (state.queue.length > 0) {
    return state.queue.map(remoteTrackToPlayerTrack);
  }
  if (state.track_entity_uid || state.track_id || state.track_path) {
    return [
      remoteTrackToPlayerTrack({
        track_id: state.track_id ?? undefined,
        track_entity_uid: state.track_entity_uid ?? undefined,
        path: state.track_path ?? undefined,
        title: state.title,
        artist: state.artist,
        album: state.album,
        album_cover: state.album_cover ?? undefined,
        duration:
          typeof state.duration_ms === "number"
            ? state.duration_ms / 1000
            : undefined,
      }),
    ];
  }
  return [];
}

export function isRecentlyPlayingRemote(
  state: RemotePlaybackState,
  nowMs = Date.now(),
): boolean {
  if (state.status !== "playing" || !state.updated_at) return false;
  const updatedAt = Date.parse(state.updated_at);
  if (!Number.isFinite(updatedAt)) return false;
  return nowMs - updatedAt <= 90000;
}

export function isFreshRemotePlaybackState(
  state: RemotePlaybackState,
  nowMs = Date.now(),
): boolean {
  if (!state.updated_at) return false;
  const updatedAt = Date.parse(state.updated_at);
  if (!Number.isFinite(updatedAt)) return false;
  return nowMs - updatedAt <= 300000;
}

export function shouldPromptForRemoteResume(
  state: RemotePlaybackState | null,
  {
    currentDeviceId = getListenDeviceId(),
    localSavedAt,
  }: { currentDeviceId?: string; localSavedAt?: string | null } = {},
): state is RemotePlaybackState {
  if (!state) return false;
  if (state.device_id === currentDeviceId) return false;
  if (!remotePlaybackQueue(state).length) return false;
  if (!state.updated_at || !localSavedAt) return true;
  const remoteAt = Date.parse(state.updated_at);
  const localAt = Date.parse(localSavedAt);
  if (!Number.isFinite(remoteAt) || !Number.isFinite(localAt)) return true;
  return remoteAt > localAt;
}
