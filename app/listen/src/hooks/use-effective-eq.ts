import { useMemo } from "react";

import type { Track } from "@/contexts/player-types";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import {
  trackEffectiveEqApiPath,
  trackEqPresetApiPath,
} from "@/lib/library-routes";

export interface EffectiveEq {
  trackId: number;
  trackEntityUid: string | null;
  albumId: number | null;
  albumEntityUid: string | null;
  gains: number[];
  source:
    | "user_track_preset"
    | "instance_track_preset"
    | "instance_album_preset"
    | "genre_taxonomy_preset"
    | "audio_analysis_preset"
    | "flat";
  label: string;
  reasoning: string;
  scope: "user" | "instance" | null;
  targetType: "track" | "album" | null;
  targetEntityUid: string | null;
  userId: number | null;
  genre: { slug: string; name: string; canonical?: boolean } | null;
  inheritedFrom: { slug: string; name: string } | null;
}

export type EffectiveEqState =
  | { status: "idle"; refetch?: () => void }
  | { status: "loading"; refetch: () => void }
  | { status: "ready"; eq: EffectiveEq; refetch: () => void }
  | { status: "unavailable"; refetch: () => void };

export function useEffectiveEq(
  track: Track | undefined,
  enabled: boolean,
): EffectiveEqState {
  const endpoint = useMemo(() => {
    if (!track || !enabled) return null;
    return trackEffectiveEqApiPath(track) || null;
  }, [enabled, track]);

  const state = useApi<EffectiveEq>(endpoint, "GET", undefined, {
    reactive: true,
    revalidateIfCached: "idle",
  });

  if (!enabled || !track) return { status: "idle" };
  if (!endpoint) return { status: "unavailable", refetch: state.refetch };
  if (state.data)
    return { status: "ready", eq: state.data, refetch: state.refetch };
  if (state.loading) return { status: "loading", refetch: state.refetch };
  return { status: "unavailable", refetch: state.refetch };
}

export async function saveTrackEqPreset(
  track: Track,
  gains: number[],
  label = "",
  reasoning = "",
): Promise<EffectiveEq | null> {
  const endpoint = trackEqPresetApiPath(track);
  if (!endpoint) return null;
  const response = await api<{ ok: boolean; preset: EffectiveEq | null }>(
    endpoint,
    "PUT",
    { gains, label, reasoning },
  );
  return response.preset;
}

export async function clearTrackEqPreset(
  track: Track,
): Promise<EffectiveEq | null> {
  const endpoint = trackEqPresetApiPath(track);
  if (!endpoint) return null;
  const response = await api<{ ok: boolean; preset: EffectiveEq | null }>(
    endpoint,
    "DELETE",
  );
  return response.preset;
}
