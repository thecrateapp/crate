// Transport fades scheduled on the audio clock.
//
// Fading by animation frames (gapless-player-volume) only moves the gain when
// the main thread runs. A resume starts the track at gain 0 and then waits for
// those frames; if the page is busy, or the fade waits behind audio recovery,
// the track plays silently while the playhead advances, so audio "starts late
// and skips ahead". A ramp scheduled on the player's master gain runs on the
// audio thread from the moment playback starts, whatever the page is doing.

import type { Gapless5 } from "@/lib/gapless5/gapless5";

interface FadeOutput {
  context: BaseAudioContext;
  masterOut: GainNode;
}

function outputOf(player: Gapless5 | null): FadeOutput | null {
  const candidate = player as unknown as Partial<FadeOutput> | null;
  if (!candidate?.context || !candidate.masterOut) return null;
  return candidate as FadeOutput;
}

/**
 * Ramps the master gain from `from` ("current" keeps where it is) to `to`
 * over `durationMs`, starting now on the audio clock. Returns false when the
 * player has no WebAudio output to schedule on; the caller then falls back to
 * a frame-driven fade.
 */
export function rampOutputGain(
  player: Gapless5 | null,
  from: number | "current",
  to: number,
  durationMs: number,
): boolean {
  const output = outputOf(player);
  if (!output) return false;
  const { gain } = output.masterOut;
  const now = output.context.currentTime;
  const start = from === "current" ? gain.value : from;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(start, now);
  gain.linearRampToValueAtTime(to, now + Math.max(0, durationMs) / 1000);
  return true;
}

/** Drops any scheduled fade and puts the master gain back at unity. */
export function resetOutputGain(player: Gapless5 | null): void {
  const output = outputOf(player);
  if (!output) return;
  const { gain } = output.masterOut;
  const now = output.context.currentTime;
  gain.cancelScheduledValues(now);
  gain.setValueAtTime(1, now);
}
