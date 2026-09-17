import { isNative } from "@/lib/capacitor-runtime";
import {
  getNativeMediaSessionBridge,
  type NativeMediaControlEvent,
  type NativeMediaSessionPayload,
} from "@/lib/native-media-session-bridge";

export type {
  NativeMediaControl,
  NativeMediaSessionPayload,
} from "@/lib/native-media-session-bridge";

let nativeInterruptionResumeAllowed = true;

export function markNativeMediaSessionPlayingIntent(): void {
  nativeInterruptionResumeAllowed = true;
}

export function shouldResumeAfterNativeInterruption(): boolean {
  return nativeInterruptionResumeAllowed;
}

export async function syncNativeMediaSession(
  payload: NativeMediaSessionPayload,
): Promise<void> {
  if (!isNative) return;
  try {
    await getNativeMediaSessionBridge().update(payload);
  } catch {
    // Native media controls are best-effort and should never interrupt playback.
  }
}

export async function stopNativeMediaSession(options?: {
  suppressControl?: boolean;
}): Promise<void> {
  if (!isNative) return;
  nativeInterruptionResumeAllowed = false;
  try {
    await getNativeMediaSessionBridge().stop(options);
  } catch {
    // Ignore native bridge failures during teardown.
  }
}

export async function cancelNativeMediaSessionResume(): Promise<void> {
  if (!isNative) return;
  nativeInterruptionResumeAllowed = false;
  try {
    await getNativeMediaSessionBridge().cancelPendingResume();
  } catch {
    // Older native shells may not expose interruption intent tracking.
  }
}

export async function onNativeMediaControl(
  listener: (event: NativeMediaControlEvent) => void,
): Promise<() => void> {
  if (!isNative) return () => {};
  const handle = await getNativeMediaSessionBridge().addListener(
    "control",
    listener,
  );
  return () => {
    void handle.remove();
  };
}
