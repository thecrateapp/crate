import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";

export interface PlayerQueueSnapshot {
  queue: Track[];
  currentIndex: number;
  currentTime: number;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  playSource: PlaySource | null;
  unshuffledQueue: Track[] | null;
}

export interface JamQueueSyncPlan {
  currentIndex: number;
  positionSeconds: number;
  playing: boolean;
}

function identities(track: Track | null | undefined): string[] {
  if (!track) return [];
  return [
    track.globalTrackUid,
    track.entityUid,
    track.id,
    track.path,
    track.libraryTrackId != null
      ? `library:${track.libraryTrackId}`
      : undefined,
  ].filter((value): value is string => Boolean(value));
}

export function tracksMatch(
  left: Track | null | undefined,
  right: Track | null | undefined,
): boolean {
  const rightIdentities = new Set(identities(right));
  return identities(left).some((identity) => rightIdentities.has(identity));
}

export function findTrackIndex(
  queue: Track[],
  track: Track | null | undefined,
): number {
  if (!track) return -1;
  return queue.findIndex((candidate) => tracksMatch(candidate, track));
}

export function createPlayerQueueSnapshot(
  snapshot: PlayerQueueSnapshot,
): PlayerQueueSnapshot {
  return {
    ...snapshot,
    queue: [...snapshot.queue],
    unshuffledQueue: snapshot.unshuffledQueue
      ? [...snapshot.unshuffledQueue]
      : null,
  };
}

export function getJamQueueSyncPlan({
  currentQueue,
  currentIndex,
  currentTime,
  isPlaying,
  nextQueue,
  currentTrack,
  positionSeconds,
  playing,
}: {
  currentQueue: Track[];
  currentIndex: number;
  currentTime: number;
  isPlaying: boolean;
  nextQueue: Track[];
  currentTrack?: Track | null;
  positionSeconds?: number;
  playing?: boolean;
}): JamQueueSyncPlan {
  const activeTrack = currentTrack || currentQueue[currentIndex];
  const requestedIndex = findTrackIndex(nextQueue, activeTrack);
  const activeTrackStillExists = requestedIndex >= 0;
  const nextIndex =
    requestedIndex >= 0
      ? requestedIndex
      : Math.min(Math.max(currentIndex, 0), Math.max(nextQueue.length - 1, 0));

  return {
    currentIndex: nextIndex,
    positionSeconds: Math.max(
      0,
      positionSeconds ?? (activeTrackStillExists ? currentTime : 0),
    ),
    playing: playing ?? isPlaying,
  };
}
