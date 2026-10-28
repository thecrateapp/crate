import type { EngineMixState } from "../../lib/playback-engine";

export type PlayerMixTone = "crossfade" | "beatmatch";

// The actual engine technique owns both the readout and the existing disc ring.
export const PLAYER_MIX_COLORS = {
  crossfade: "var(--state-info)",
  beatmatch: "var(--state-warning)",
  neutral: "var(--text-subtle)",
} as const;

export interface PlayerMixPresentation {
  mode: EngineMixState["mode"];
  color: string;
  ringTone?: PlayerMixTone;
  bassHandoff: boolean;
  activity: "mixing" | "paused" | "buffering" | "gapless";
}

export function resolvePlayerMixPresentation(
  state: EngineMixState | null | undefined,
  playback: {
    currentTrackId: string;
    isPlaying: boolean;
    isBuffering: boolean;
  },
): PlayerMixPresentation | null {
  if (!state) return null;
  const edge = [state.outgoingTrackId, state.incomingTrackId].filter(Boolean);
  if (edge.length > 0 && !edge.includes(playback.currentTrackId)) return null;
  if (state.mode === "gapless") {
    return {
      mode: "gapless",
      color: PLAYER_MIX_COLORS.neutral,
      bassHandoff: false,
      activity: "gapless",
    };
  }
  if (
    state.phase !== "mixing" ||
    (state.mode !== "crossfade" && state.mode !== "beatmatch")
  )
    return null;
  const activity = playback.isBuffering
    ? "buffering"
    : !playback.isPlaying
      ? "paused"
      : "mixing";
  const ringTone = activity === "mixing" ? state.mode : undefined;
  return {
    mode: state.mode,
    color: ringTone ? PLAYER_MIX_COLORS[ringTone] : PLAYER_MIX_COLORS.neutral,
    ringTone,
    bassHandoff: state.mode === "beatmatch" && state.bassHandoff === true,
    activity,
  };
}
