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
let initialization: Promise<void> | null = null;
let sentryModulePromise: Promise<SentryModule | null> | null = null;
let apiErrorReporter: ReturnType<typeof createApiErrorReporter> | null = null;

export function initSentry(): Promise<void> {
  const config = getSentryConfig();
  if (initialized || !config) return Promise.resolve();
  if (initialization) return initialization;

  initialization = loadSentry().then((sentry) => {
    if (!sentry || initialized) return;

    sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
      sendDefaultPii: false,
      integrations: [
        sentry.browserTracingIntegration(),
        sentry.rewriteFramesIntegration({
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
    });
    initialized = true;
  });

  return initialization;
}

export function captureApiError(
  error: unknown,
  context: Parameters<ReturnType<typeof createApiErrorReporter>>[1],
): void {
  void withSentry((sentry) => {
    apiErrorReporter ??= createApiErrorReporter(sentry);
    apiErrorReporter(error, context);
  });
}

export function captureRenderError(error: Error, info: ErrorInfo): void {
  void withSentry((sentry) => {
    sentry.withScope((scope) => {
      scope.setExtra("react.component_stack", info.componentStack);
      sentry.captureException(error);
    });
  });
}

export function captureRuntimeError(
  error: unknown,
  operation: string,
): Promise<void> {
  return withSentry((sentry) => {
    sentry.withScope((scope) => {
      scope.setTag("runtime.operation", operation);
      scope.setFingerprint([
        "listen-runtime-error",
        operation,
        "{{ default }}",
      ]);
      sentry.captureException(error);
    });
  });
}

export function setSentryUser(userId: number | string | null): Promise<void> {
  return withSentry((sentry) => {
    sentry.setUser(userId == null ? null : { id: String(userId) });
  });
}

type SentryModule = typeof import("@sentry/react");

/**
 * DSN and environment, or null when Sentry stays off: no DSN, or a
 * production build served from a local-network http origin.
 */
function getSentryConfig(): { dsn: string; environment: string } | null {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim() || "";
  if (!dsn) return null;
  const environment = resolveSentryEnvironment(
    import.meta.env.VITE_SENTRY_ENVIRONMENT,
    typeof window === "undefined" ? undefined : window.location,
  );
  return environment ? { dsn, environment } : null;
}

function loadSentry(): Promise<SentryModule | null> {
  return (sentryModulePromise ??= import("@sentry/react").catch(() => null));
}

function withSentry(callback: (sentry: SentryModule) => void): Promise<void> {
  if (!getSentryConfig()) return Promise.resolve();

  return initSentry()
    .then(() => loadSentry())
    .then((sentry) => {
      if (sentry) callback(sentry);
    });
}

function parseSampleRate(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}
