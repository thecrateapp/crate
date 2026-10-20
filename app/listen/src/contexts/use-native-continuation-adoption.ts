import { useCallback } from "react";

import type { Track } from "@/contexts/player-types";
import {
  androidNativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import type { EngineAppendedTrack } from "@/lib/playback-engine";
import { toRadioTrack, toShapedRadioTrack } from "@/lib/radio-model";

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
  adoptTracks,
  queueRef,
}: {
  adoptTracks: (tracks: Track[]) => void;
  queueRef: ValueRef<Track[]>;
}) {
  return useCallback(async () => {
    if (!shouldUseAndroidNativePlayer()) return;
    const appended = await androidNativeEngine.takeAppendedTracks();
    if (appended.length === 0) return;
    const known = new Set(queueRef.current.map((track) => track.id));
    const tracks = appended
      .map(nativeAppendedTrackToTrack)
      .filter((track) => !known.has(track.id));
    if (tracks.length > 0) adoptTracks(tracks);
  }, [adoptTracks, queueRef]);
}
