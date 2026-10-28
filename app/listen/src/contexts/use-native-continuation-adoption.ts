import { useCallback, type MutableRefObject } from "react";

import type { PlaySource, Track } from "@/contexts/player-types";
import {
  androidNativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import { ensureContinuationSession } from "@/lib/radio-continuation";
import type { EngineAppendedTrack } from "@/lib/playback-engine";
import { toRadioTrack, toShapedRadioTrack } from "@/lib/radio-model";

import type { PlaybackQueueReadiness } from "./playback-intelligence-model";

type ValueRef<T> = { readonly current: T };

export function nativeAppendedTrackToTrack(entry: EngineAppendedTrack): Track {
  const source: unknown = entry.source;
  const track =
    "track_entity_uid" in entry.source
      ? toRadioTrack(source as Parameters<typeof toRadioTrack>[0])
      : toShapedRadioTrack(source as Parameters<typeof toShapedRadioTrack>[0]);
  return {
    ...track,
    id: entry.id,
    entityUid: track.entityUid ?? entry.entityUid,
    duration:
      track.duration ??
      (entry.durationMs > 0 ? entry.durationMs / 1000 : undefined),
  };
}

export function useNativeContinuationAdoption({
  queueReadinessRef,
  adoptTracks,
  queueRef,
  playSourceRef,
}: {
  queueReadinessRef?: MutableRefObject<PlaybackQueueReadiness>;
  adoptTracks: (tracks: Track[]) => void;
  queueRef: ValueRef<Track[]>;
  playSourceRef?: ValueRef<PlaySource | null>;
}) {
  return useCallback(async () => {
    const isReady = () => queueReadinessRef?.current.ready !== false;
    if (!shouldUseAndroidNativePlayer() || !isReady()) return;
    const generation = queueReadinessRef?.current.generation;
    const source = playSourceRef?.current;
    const expectedSession = source?.radio
      ? ensureContinuationSession(source)
      : null;
    const appended = await androidNativeEngine.takeAppendedTracks();
    if (
      playSourceRef?.current !== source ||
      !isReady() ||
      generation !== queueReadinessRef?.current.generation
    )
      return;
    const cursor = androidNativeEngine.getContinuationCursor();
    if (
      playSourceRef &&
      (!expectedSession ||
        !cursor ||
        cursor.sessionId !== expectedSession ||
        cursor.revision !== (source?.radio?.continuationRevision ?? 1))
    )
      return;
    const radio = playSourceRef?.current?.radio;
    if (
      cursor &&
      radio &&
      (radio.continuationSessionId ?? radio.shapedSessionId) ===
        cursor.sessionId
    ) {
      radio.continuationBatchIndex = Math.max(
        radio.continuationBatchIndex ?? (radio.shapedSessionId ? 1 : 0),
        cursor.batchIndex,
      );
      radio.continuationRevision = cursor.revision;
    }
    if (appended.length === 0) return;
    const known = new Set(queueRef.current.map((track) => track.id));
    const tracks = appended
      .map(nativeAppendedTrackToTrack)
      .filter((track) => !known.has(track.id));
    if (tracks.length > 0) adoptTracks(tracks);
  }, [adoptTracks, queueRef, playSourceRef, queueReadinessRef]);
}
