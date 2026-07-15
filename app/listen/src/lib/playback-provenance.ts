import type { Track } from "@/contexts/player-types";

const playbackSessions = new Map<string, string>();

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
