export type NativePlaybackRecoveryCancellation =
  | "pause"
  | "stop"
  | "superseded";

let generation = 0;
let latestCancellation: NativePlaybackRecoveryCancellation | null = null;

function advance(
  cancellation: NativePlaybackRecoveryCancellation | null,
): number {
  generation = generation === Number.MAX_SAFE_INTEGER ? 1 : generation + 1;
  latestCancellation = cancellation;
  return generation;
}

export function captureNativePlaybackRecoveryIntent(): number {
  return generation;
}

export function beginNativePlaybackIntent(): void {
  advance(null);
}

export function cancelNativePlaybackRecoveryIntent(
  cancellation: "pause" | "stop" = "pause",
): void {
  advance(cancellation);
}

export function nativePlaybackRecoveryCancellationSince(
  capturedGeneration: number,
): NativePlaybackRecoveryCancellation | null {
  if (capturedGeneration === generation) return null;
  return latestCancellation ?? "superseded";
}

export function isNativePlaybackRecoveryIntentCurrent(
  capturedGeneration: number,
): boolean {
  return capturedGeneration === generation;
}
