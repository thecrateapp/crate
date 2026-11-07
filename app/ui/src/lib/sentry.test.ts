import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  addBreadcrumb,
  captureException,
  init,
  setUser,
  withScope,
  browserTracingIntegration,
  rewriteFramesIntegration,
} = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  init: vi.fn(),
  setUser: vi.fn(),
  withScope: vi.fn(),
  browserTracingIntegration: vi.fn(() => "browser-tracing"),
  rewriteFramesIntegration: vi.fn(() => "rewrite-frames"),
}));

vi.mock("@sentry/react", () => ({
  addBreadcrumb,
  captureException,
  init,
  setUser,
  withScope,
  browserTracingIntegration,
  rewriteFramesIntegration,
}));

type SentryModule = typeof import("./sentry");

async function loadSentry(): Promise<SentryModule> {
  vi.resetModules();
  return import("./sentry");
}

function initOptions() {
  return init.mock.calls[0]![0] as {
    beforeSend: (
      event: Record<string, unknown>,
      hint?: { originalException?: unknown },
    ) => Record<string, unknown> | null;
  };
}

describe("admin Sentry setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("does not initialize without a DSN", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    const { initSentry } = await loadSentry();

    initSentry();

    expect(init).not.toHaveBeenCalled();
  });

  it("initializes tracing with privacy-safe defaults", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/1");
    vi.stubEnv("VITE_SENTRY_ENVIRONMENT", "test");
    vi.stubEnv("VITE_SENTRY_RELEASE", "crate-test");
    const { initSentry } = await loadSentry();

    initSentry();

    expect(browserTracingIntegration).toHaveBeenCalledOnce();
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public@example.test/1",
        environment: "test",
        release: "crate-test",
        sendDefaultPii: false,
        integrations: ["browser-tracing", "rewrite-frames"],
      }),
    );
  });

  it("rewrites the admin bundle frames to app:///", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/1");
    vi.stubEnv("VITE_SENTRY_ENVIRONMENT", "test");
    const { initSentry } = await loadSentry();

    initSentry();

    const [{ iteratee }] = rewriteFramesIntegration.mock
      .calls[0] as unknown as [
      { iteratee: (frame: { filename: string }) => { filename: string } },
    ];
    expect(
      iteratee({ filename: `${window.location.origin}/assets/Browse-x.js` })
        .filename,
    ).toBe("app:///assets/Browse-x.js");
  });

  it("drops network failures and scrubs the events it sends", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/1");
    vi.stubEnv("VITE_SENTRY_ENVIRONMENT", "test");
    const { initSentry } = await loadSentry();
    initSentry();
    const { beforeSend } = initOptions();

    expect(
      beforeSend(
        { exception: { values: [{ type: "TypeError", value: "x" }] } },
        { originalException: new TypeError("Failed to fetch") },
      ),
    ).toBeNull();
    expect(
      beforeSend({
        request: { url: "https://admin.lespedants.org/api/x?token=secret" },
      }),
    ).toEqual({
      request: expect.objectContaining({ url: "/api/x" }),
    });
  });

  it("stays off for a production build served from a local http origin", async () => {
    // jsdom serves the page from http://localhost, like a LAN home install.
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/1");
    vi.stubEnv("VITE_SENTRY_ENVIRONMENT", "production");
    const { initSentry } = await loadSentry();

    initSentry();

    expect(init).not.toHaveBeenCalled();
  });

  it("keeps API network failures as breadcrumbs", async () => {
    const { captureApiError } = await loadSentry();

    captureApiError(new TypeError("Failed to fetch"), {
      method: "GET",
      url: "/api/admin/ops-snapshot",
    });

    expect(captureException).not.toHaveBeenCalled();
    expect(addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({ category: "api-client" }),
    );
  });

  it("sets only the authenticated user's stable id", async () => {
    const { setSentryUser } = await loadSentry();

    setSentryUser(42);
    setSentryUser(null);

    expect(setUser).toHaveBeenNthCalledWith(1, { id: "42" });
    expect(setUser).toHaveBeenNthCalledWith(2, null);
  });
});
