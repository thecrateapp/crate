import type { CrossfadeTransition } from "@/contexts/player-context";
import type { Track } from "@/contexts/player-types";
import type { EngineTransitionEvent } from "@/lib/playback-engine";

function resolveTrack(
  queue: Track[],
  index: number | undefined,
  trackId: string | undefined,
): Track | undefined {
  if (index != null && index >= 0 && index < queue.length) {
    const indexed = queue[index];
    if (indexed && (!trackId || indexed.id === trackId)) {
      return indexed;
    }
  }
  if (!trackId) return undefined;
  return queue.find((track) => track.id === trackId);
}

export function resolveNativeCrossfadeTransition(
  event: EngineTransitionEvent,
  queue: Track[],
  nowMs: number,
  fallbackOutgoingDurationSeconds = 0,
): CrossfadeTransition | null {
  const durationMs = Math.max(0, event.durationMs ?? 0);
  if (event.type !== "crossfade" || durationMs === 0) {
    return null;
  }

  const outgoing = resolveTrack(
    queue,
    event.outgoingIndex,
    event.outgoingTrackId,
  );
  const incoming = resolveTrack(
    queue,
    event.incomingIndex,
    event.incomingTrackId,
  );
  if (!outgoing || !incoming || outgoing.id === incoming.id) {
    return null;
  }

  const progress = Math.max(0, Math.min(event.progress ?? 0, 1));
  return {
    outgoing,
    incoming,
    durationMs,
    startedAt: nowMs - durationMs * progress,
    outgoingDurationSeconds:
      outgoing.duration ?? fallbackOutgoingDurationSeconds,
  };
}
