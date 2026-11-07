import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  init,
  setUser,
  addBreadcrumb,
  captureException,
  setFingerprint,
  setTag,
  withScope,
  browserTracingIntegration,
  rewriteFramesIntegration,
} = vi.hoisted(() => {
  const setFingerprint = vi.fn();
  const setTag = vi.fn();

  return {
    init: vi.fn(),
    setUser: vi.fn(),
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
    setFingerprint,
    setTag,
    withScope: vi.fn((callback: (scope: unknown) => void) =>
      callback({ setFingerprint, setTag }),
    ),
    browserTracingIntegration: vi.fn(() => "browser-tracing"),
    rewriteFramesIntegration: vi.fn(() => "rewrite-frames"),
  };
});

vi.mock("@sentry/react", () => ({
  init,
  setUser,
  addBreadcrumb,
  captureException,
  withScope,
  browserTracingIntegration,
  rewriteFramesIntegration,
}));

import {
  captureApiError,
  captureRuntimeError,
  initSentry,
  setSentryUser,
} from "./sentry";

async function loadIsolatedSentry(): Promise<typeof import("./sentry")> {
  vi.resetModules();
  return import("./sentry");
}

describe("Listen Sentry setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("initializes tracing asynchronously for web and desktop", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/2");

    const initialization = initSentry();

    expect(initialization).toBeInstanceOf(Promise);
    await initialization;

    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public@example.test/2",
        sendDefaultPii: false,
        integrations: ["browser-tracing", "rewrite-frames"],
      }),
    );
    const [{ iteratee }] = rewriteFramesIntegration.mock
      .calls[0] as unknown as [
      { iteratee: (frame: { filename: string }) => { filename: string } },
    ];
    expect(
      iteratee({ filename: `${window.location.origin}/assets/Stats-x.js` })
        .filename,
    ).toBe("app:///assets/Stats-x.js");
    const { beforeSend } = init.mock.calls[0]![0] as {
      beforeSend: (
        event: Record<string, unknown>,
        hint?: { originalException?: unknown },
      ) => unknown;
    };
    expect(
      beforeSend(
        {},
        {
          originalException: new DOMException(
            "The operation was aborted.",
            "AbortError",
          ),
        },
      ),
    ).toBeNull();
  });

  it("stays off for a production build served from a local http origin", async () => {
    // jsdom serves the page from http://localhost, like a LAN home install.
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/2");
    vi.stubEnv("VITE_SENTRY_ENVIRONMENT", "production");
    const isolated = await loadIsolatedSentry();

    await isolated.initSentry();
    await isolated.captureRuntimeError(new Error("boom"), "bootstrap");

    expect(init).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("keeps API network failures as breadcrumbs", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/2");

    captureApiError(new TypeError("Load failed"), {
      method: "POST",
      url: "/api/me/now-playing",
    });
    await vi.waitFor(() => expect(addBreadcrumb).toHaveBeenCalled());

    expect(captureException).not.toHaveBeenCalled();
  });

  it("clears the stable user id on logout", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/2");

    await setSentryUser("listen-user");
    await setSentryUser(null);

    expect(setUser).toHaveBeenNthCalledWith(1, { id: "listen-user" });
    expect(setUser).toHaveBeenNthCalledWith(2, null);
  });

  it("groups runtime failures by operation", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/2");
    const error = new Error("offline profile failed");

    await captureRuntimeError(error, "offline.profile.prime");

    expect(withScope).toHaveBeenCalledOnce();
    expect(setTag).toHaveBeenCalledWith(
      "runtime.operation",
      "offline.profile.prime",
    );
    expect(setFingerprint).toHaveBeenCalledWith([
      "listen-runtime-error",
      "offline.profile.prime",
      "{{ default }}",
    ]);
    expect(captureException).toHaveBeenCalledWith(error);
  });
});
