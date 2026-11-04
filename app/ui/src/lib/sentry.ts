import * as Sentry from "@sentry/react";

import {
  createApiErrorReporter,
  createSentryBeforeSend,
  createSentryFrameNormalizer,
  resolveSentryEnvironment,
  sentryAppOrigin,
} from "../../../shared/web/sentry";
import type { ErrorInfo } from "react";
import { isStaleChunkReloadPending } from "./stale-chunk-reload";

let initialized = false;

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (initialized || !dsn) return;
  const environment = resolveSentryEnvironment(
    import.meta.env.VITE_SENTRY_ENVIRONMENT,
    window.location,
  );
  if (!environment) return;

  Sentry.init({
    dsn,
    environment,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.rewriteFramesIntegration({
        iteratee: createSentryFrameNormalizer(sentryAppOrigin(window.location)),
      }),
    ],
    tracesSampleRate: parseSampleRate(
      import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE,
      0.1,
    ),
    beforeSend: createSentryBeforeSend({
      suppress: isStaleChunkReloadPending,
    }),
  });
  initialized = true;
}

export const captureApiError = createApiErrorReporter(Sentry);

export function captureRenderError(error: Error, info: ErrorInfo): void {
  Sentry.withScope((scope) => {
    scope.setExtra("react.component_stack", info.componentStack);
    Sentry.captureException(error);
  });
}

export function setSentryUser(userId: number | string | null): void {
  Sentry.setUser(userId == null ? null : { id: String(userId) });
}

function parseSampleRate(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}
