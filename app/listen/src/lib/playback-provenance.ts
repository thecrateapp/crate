import type { Track } from "@/contexts/player-types";

const playbackSessions = new Map<string, string>();
const playbackDeliveryProvenance = new Map<
  string,
  PlaybackDeliveryProvenance
>();

export interface PlaybackDeliveryProvenance {
  requestedPolicy: "original" | "balanced" | "data_saver";
  effectivePolicy: "original" | "balanced" | "data_saver";
  origin: "local" | "remote" | "imported";
}

function playbackSessionKey(track: Track): string {
  return (
    track.globalTrackUid ||
    track.entityUid ||
    track.remote?.remoteEntityUid ||
    track.id
  );
}

export function setPlaybackSession(
  track: Track,
  playbackSession: string | null | undefined,
): void {
  if (!playbackSession) return;
  playbackSessions.set(playbackSessionKey(track), playbackSession);
}

export function getPlaybackSession(track: Track): string | null {
  return (
    track.remote?.playbackSession ||
    playbackSessions.get(playbackSessionKey(track)) ||
    null
  );
}

function isPlaybackPolicy(
  value: unknown,
): value is PlaybackDeliveryProvenance["requestedPolicy"] {
  return value === "original" || value === "balanced" || value === "data_saver";
}

function isPlaybackOrigin(
  value: unknown,
): value is PlaybackDeliveryProvenance["origin"] {
  return value === "local" || value === "remote" || value === "imported";
}

export function setPlaybackDeliveryProvenance(
  track: Track,
  resolution: {
    requested_policy?: unknown;
    effective_policy?: unknown;
    content_origin?: unknown;
  },
): void {
  if (
    !isPlaybackPolicy(resolution.requested_policy) ||
    !isPlaybackPolicy(resolution.effective_policy) ||
    !isPlaybackOrigin(resolution.content_origin)
  ) {
    return;
  }
  playbackDeliveryProvenance.set(playbackSessionKey(track), {
    requestedPolicy: resolution.requested_policy,
    effectivePolicy: resolution.effective_policy,
    origin: resolution.content_origin,
  });
}

export function getPlaybackDeliveryProvenance(
  track: Track,
): PlaybackDeliveryProvenance | null {
  return playbackDeliveryProvenance.get(playbackSessionKey(track)) ?? null;
}
