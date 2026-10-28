import type { EngineMixState } from "./playback-engine";

/** Older/invalid native payloads remain unknown; plans and visual clocks are not evidence. */
export function actualNativeMixState(
  value: EngineMixState | null | undefined,
  revision: string,
): EngineMixState | null {
  if (
    !value ||
    !revision ||
    value.revision !== revision ||
    !Number.isInteger(value.executionId) ||
    value.executionId < 0
  )
    return null;
  if (
    value.mode === "gapless"
      ? value.phase !== "idle"
      : (value.mode !== "crossfade" && value.mode !== "beatmatch") ||
        value.phase !== "mixing"
  )
    return null;
  if (typeof value.bassHandoff !== "boolean") return null;
  return {
    revision,
    executionId: value.executionId,
    mode: value.mode,
    phase: value.phase,
    bassHandoff: value.mode === "beatmatch" && value.bassHandoff,
    ...(value.outgoingTrackId
      ? { outgoingTrackId: value.outgoingTrackId }
      : {}),
    ...(value.incomingTrackId
      ? { incomingTrackId: value.incomingTrackId }
      : {}),
    ...(typeof value.durationMs === "number" &&
    Number.isFinite(value.durationMs) &&
    value.durationMs > 0
      ? { durationMs: value.durationMs }
      : {}),
  };
}

export function sameNativeMixState(
  a: EngineMixState | null,
  b: EngineMixState | null,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.revision === b.revision &&
      a.executionId === b.executionId &&
      a.mode === b.mode &&
      a.phase === b.phase &&
      a.bassHandoff === b.bassHandoff &&
      a.outgoingTrackId === b.outgoingTrackId &&
      a.incomingTrackId === b.incomingTrackId &&
      a.durationMs === b.durationMs)
  );
}
