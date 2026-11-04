import * as Sentry from "@sentry/capacitor";
import {
  init as initReactSentry,
  rewriteFramesIntegration,
} from "@sentry/react";

import {
  createSentryBeforeSend,
  createSentryFrameNormalizer,
  resolveSentryEnvironment,
  sentryAppOrigin,
} from "../../../shared/web/sentry";
import { isStaleChunkReloadPending } from "./stale-chunk-reload";

let initialized = false;

export function initNativeSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (initialized || !dsn) return;
  const environment = resolveSentryEnvironment(
    import.meta.env.VITE_SENTRY_ENVIRONMENT,
    window.location,
  );
  if (!environment) return;

  Sentry.init(
    {
      dsn,
      environment,
      release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
      sendDefaultPii: false,
      enableNative: true,
      enableNativeCrashHandling: true,
      enableCaptureFailedRequests: true,
      integrations: [
        Sentry.browserTracingIntegration(),
        // Replaces the Capacitor SDK's default RewriteFrames (same name), which
        // left Android frames as bare `/assets/...` and iOS ones as
        // `app:///assets/...`; every runtime now uses `app:///assets/...`.
        rewriteFramesIntegration({
          iteratee: createSentryFrameNormalizer(
            sentryAppOrigin(window.location),
          ),
        }),
      ],
      tracesSampleRate: parseSampleRate(
        import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
        0.1,
      ),
      beforeSend: createSentryBeforeSend({
        suppress: isStaleChunkReloadPending,
      }),
    },
    initReactSentry,
  );
  initialized = true;
}

export function captureNativeRuntimeError(
  error: unknown,
  operation: string,
): void {
  Sentry.withScope((scope) => {
    scope.setTag("runtime.operation", operation);
    scope.setTag("runtime.platform", "capacitor");
    scope.setFingerprint(["listen-runtime-error", operation, "{{ default }}"]);
    Sentry.captureException(error);
  });
}

function parseSampleRate(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}
