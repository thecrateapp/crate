import { isCapacitorRuntime } from "./platform";
import { captureRuntimeError, initSentry } from "./sentry";

export async function initRuntimeSentry(
  nativeRuntime = isCapacitorRuntime,
): Promise<void> {
  if (nativeRuntime) {
    const { initNativeSentry } = await import("./sentry-capacitor");
    initNativeSentry();
    return;
  }

  await initSentry();
}

export async function reportRuntimeError(
  error: unknown,
  operation: string,
  nativeRuntime = isCapacitorRuntime,
): Promise<void> {
  if (nativeRuntime) {
    const { captureNativeRuntimeError } = await import("./sentry-capacitor");
    captureNativeRuntimeError(error, operation);
    return;
  }

  await captureRuntimeError(error, operation);
}
