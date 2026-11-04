import { describe, expect, it, vi } from "vitest";
import {
  API_UNAVAILABLE_FINGERPRINT,
  createApiErrorReporter,
  createSentryBeforeSend,
  createSentryFrameNormalizer,
  isAbortError,
  isLocalNetworkHttpOrigin,
  isNetworkFailure,
  resolveSentryEnvironment,
  safeRequestPath,
  scrubSentryEvent,
  sentryAppOrigin,
  shouldDropSentryEvent,
  type SentryApi,
  type SentryEventLike,
} from "./sentry";

function createMockSentry() {
  const scope = {
    setTag: vi.fn(),
    setContext: vi.fn(),
    setFingerprint: vi.fn(),
  };
  const sentry: SentryApi = {
    addBreadcrumb: vi.fn(),
    captureException: vi.fn(),
    withScope: vi.fn((callback) => callback(scope)),
  };
  return { sentry, scope };
}

function typeError(message: string): TypeError {
  return new TypeError(message);
}

function exceptionEvent(
  ...values: Array<{ type?: string; value?: string }>
): SentryEventLike {
  return { exception: { values } };
}

describe("shared Sentry helpers", () => {
  it("reports server failures with a safe request context", () => {
    const { sentry, scope } = createMockSentry();
    const report = createApiErrorReporter(sentry);
    const error = new Error("server failed");

    report(error, {
      method: "GET",
      url: "https://api.example.test/api/me?token=secret",
      status: 503,
    });

    expect(scope.setTag).toHaveBeenCalledWith("error.source", "api-client");
    expect(scope.setTag).toHaveBeenCalledWith("http.status_code", "503");
    expect(scope.setContext).toHaveBeenCalledWith("request", {
      method: "GET",
      url: "/api/me",
      status: 503,
    });
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "API request failed with HTTP 503",
      }),
    );
  });

  it("does not report aborts or expected client failures", () => {
    const { sentry } = createMockSentry();
    const report = createApiErrorReporter(sentry);

    report(new DOMException("aborted", "AbortError"), {
      method: "GET",
      url: "/api/me",
      status: 499,
    });
    report(new Error("validation"), {
      method: "POST",
      url: "/api/me",
      status: 422,
    });

    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it.each([
    ["Chrome", typeError("Failed to fetch")],
    [
      "Chrome with the SDK host suffix",
      typeError("Failed to fetch (api.lespedants.org)"),
    ],
    ["Safari", typeError("Load failed")],
    ["Firefox", typeError("NetworkError when attempting to fetch resource.")],
    [
      "the Tauri HTTP plugin (string rejection)",
      "error sending request for url (https://api.lespedants.org/api/auth/heartbeat)",
    ],
    [
      "the Tauri HTTP plugin (wrapped)",
      new Error(
        "error sending request for url (https://api.lespedants.org/api/me)",
      ),
    ],
  ])(
    "keeps a network failure from %s as a breadcrumb, not an event",
    (_runtime, error) => {
      const { sentry } = createMockSentry();
      const report = createApiErrorReporter(sentry);

      report(error, {
        method: "GET",
        url: "https://api.lespedants.org/api/me/stats/dashboard?token=secret",
      });

      expect(sentry.captureException).not.toHaveBeenCalled();
      expect(sentry.withScope).not.toHaveBeenCalled();
      expect(sentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "api-client",
          type: "http",
          level: "warning",
          data: expect.objectContaining({
            method: "GET",
            url: "/api/me/stats/dashboard",
          }),
        }),
      );
    },
  );

  it("still reports generic TypeErrors raised by the API client", () => {
    const { sentry } = createMockSentry();
    const report = createApiErrorReporter(sentry);
    const error = typeError(
      "Cannot read properties of undefined (reading 'json')",
    );

    report(error, { method: "GET", url: "/api/me" });

    expect(sentry.captureException).toHaveBeenCalledWith(error);
    expect(sentry.addBreadcrumb).not.toHaveBeenCalled();
  });

  it("does not report the stackless AbortError wrapper WebKit produces", () => {
    const { sentry } = createMockSentry();
    const report = createApiErrorReporter(sentry);

    report(new Error("AbortError: The operation was aborted."), {
      method: "GET",
      url: "/api/me",
    });

    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it.each([502, 503, 504, 521, 522, 524])(
    "groups HTTP %i into one api-unavailable issue",
    (status) => {
      const { sentry, scope } = createMockSentry();
      const report = createApiErrorReporter(sentry);

      report(new Error("bad gateway"), {
        method: "GET",
        url: `/api/route-${status}`,
        status,
      });

      expect(scope.setFingerprint).toHaveBeenCalledWith(
        API_UNAVAILABLE_FINGERPRINT,
      );
      expect(scope.setTag).toHaveBeenCalledWith(
        "http.status_code",
        String(status),
      );
      expect(sentry.captureException).toHaveBeenCalledOnce();
    },
  );

  it.each([500, 429])("keeps HTTP %i grouped by call site", (status) => {
    const { sentry, scope } = createMockSentry();
    const report = createApiErrorReporter(sentry);

    report(new Error("failed"), { method: "POST", url: "/api/x", status });

    expect(scope.setFingerprint).not.toHaveBeenCalled();
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.objectContaining({
        message: `API request failed with HTTP ${status}`,
      }),
    );
  });

  describe("isNetworkFailure", () => {
    it.each([
      typeError("Failed to fetch"),
      typeError("Failed to fetch (listen.lespedants.org)"),
      typeError("Failed to fetch (localhost:8585)"),
      typeError("Load failed"),
      typeError("Load failed (api.lespedants.org)"),
      typeError("NetworkError when attempting to fetch resource."),
      "error sending request for url (https://api.lespedants.org/api/me)",
    ])("matches %s", (error) => {
      expect(isNetworkFailure(error)).toBe(true);
    });

    it.each([
      typeError("Cannot read properties of null (reading 'id')"),
      typeError(
        "Failed to fetch dynamically imported module: https://listen.lespedants.org/assets/Stats-72HJplet.js",
      ),
      typeError("Importing a module script failed."),
      typeError("Failed to fetch the playlist"),
      new Error("Failed to fetch"),
      new Error("API request failed with HTTP 502"),
      "Failed to fetch",
      null,
      undefined,
      42,
    ])("does not match %s", (error) => {
      expect(isNetworkFailure(error)).toBe(false);
    });
  });

  describe("isAbortError", () => {
    it.each([
      new DOMException("The operation was aborted.", "AbortError"),
      new Error("AbortError: The operation was aborted."),
      Object.assign(new Error("aborted"), { name: "AbortError" }),
      "AbortError: The user aborted a request.",
    ])("matches %s", (error) => {
      expect(isAbortError(error)).toBe(true);
    });

    it.each([
      new DOMException("Not supported", "NotSupportedError"),
      new Error("The request was not an AbortError"),
      new Error("Native session migration failed"),
      null,
    ])("does not match %s", (error) => {
      expect(isAbortError(error)).toBe(false);
    });
  });

  describe("shouldDropSentryEvent", () => {
    it("drops events whose captured error is a network failure or an abort", () => {
      const event = exceptionEvent({ type: "Error", value: "anything" });

      expect(
        shouldDropSentryEvent(event, {
          originalException: typeError("Failed to fetch (api.lespedants.org)"),
        }),
      ).toBe(true);
      expect(
        shouldDropSentryEvent(event, {
          originalException: new DOMException("aborted", "AbortError"),
        }),
      ).toBe(true);
    });

    it("drops global-handler events by their top-level exception", () => {
      expect(
        shouldDropSentryEvent(
          exceptionEvent({ type: "TypeError", value: "Load failed" }),
        ),
      ).toBe(true);
      expect(
        shouldDropSentryEvent(
          exceptionEvent({
            type: "Error",
            value:
              "error sending request for url (https://api.lespedants.org/api/me)",
          }),
        ),
      ).toBe(true);
      // CRATE-LISTEN-6: a stackless DOMException becomes a synthetic Error.
      expect(
        shouldDropSentryEvent(
          exceptionEvent({
            type: "Error",
            value: "AbortError: The operation was aborted.",
          }),
        ),
      ).toBe(true);
    });

    it("keeps a real error even when its cause is a network failure", () => {
      const event = exceptionEvent(
        { type: "TypeError", value: "Failed to fetch" },
        { type: "Error", value: "Native session migration failed" },
      );

      expect(
        shouldDropSentryEvent(event, {
          originalException: new Error("Native session migration failed"),
        }),
      ).toBe(false);
    });

    it("keeps generic TypeErrors and stale-chunk errors", () => {
      expect(
        shouldDropSentryEvent(
          exceptionEvent({
            type: "TypeError",
            value: "Cannot read properties of undefined (reading 'map')",
          }),
        ),
      ).toBe(false);
      expect(
        shouldDropSentryEvent(
          exceptionEvent({
            type: "TypeError",
            value:
              "Failed to fetch dynamically imported module: https://admin.lespedants.org/assets/Browse-BVUrwAhx.js",
          }),
        ),
      ).toBe(false);
      expect(shouldDropSentryEvent({ message: "Failed to fetch" })).toBe(false);
    });
  });

  describe("createSentryBeforeSend", () => {
    it("drops noise, honours suppression, and scrubs what it keeps", () => {
      let suppressed = false;
      const beforeSend = createSentryBeforeSend({
        suppress: () => suppressed,
      });

      expect(
        beforeSend(
          exceptionEvent({ type: "TypeError", value: "Failed to fetch" }),
        ),
      ).toBeNull();

      const kept = beforeSend({
        request: { url: "https://admin.example.test/api/x?token=secret" },
        exception: { values: [{ type: "Error", value: "boom" }] },
      });
      expect(kept?.request?.url).toBe("/api/x");

      suppressed = true;
      expect(
        beforeSend(exceptionEvent({ type: "Error", value: "boom" })),
      ).toBeNull();
    });
  });

  describe("createSentryFrameNormalizer", () => {
    it.each([
      [
        "https://listen.lespedants.org",
        "https://listen.lespedants.org/assets/index-Bi8pQL.js",
      ],
      [
        "http://192.168.1.209:8580",
        "http://192.168.1.209:8580/assets/index-Bi8pQL.js",
      ],
      ["capacitor://localhost", "capacitor://localhost/assets/index-Bi8pQL.js"],
      ["https://localhost", "https://localhost/assets/index-Bi8pQL.js"],
      ["tauri://localhost", "tauri://localhost/assets/index-Bi8pQL.js"],
      [
        "http://tauri.localhost",
        "http://tauri.localhost/assets/index-Bi8pQL.js",
      ],
    ])("rewrites %s bundle frames to app:///", (origin, filename) => {
      const normalize = createSentryFrameNormalizer(origin);

      const frame = normalize({ filename, abs_path: filename, in_app: true });

      expect(frame).toEqual({
        filename: "app:///assets/index-Bi8pQL.js",
        abs_path: "app:///assets/index-Bi8pQL.js",
        in_app: true,
      });
    });

    it("leaves other origins, look-alike ports and non-URL frames alone", () => {
      const normalize = createSentryFrameNormalizer("http://localhost:80");

      expect(
        normalize({
          filename: "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js",
        }).filename,
      ).toBe("https://www.gstatic.com/cv/js/sender/v1/cast_sender.js");
      expect(
        normalize({ filename: "http://localhost:8080/assets/x.js" }).filename,
      ).toBe("http://localhost:8080/assets/x.js");
      expect(normalize({ filename: "<anonymous>" }).filename).toBe(
        "<anonymous>",
      );
      const empty: { filename?: string } = {};
      expect(normalize(empty).filename).toBeUndefined();
    });

    it("drops query strings and marks native frames as not in-app", () => {
      const normalize = createSentryFrameNormalizer("http://localhost:5174/");

      expect(
        normalize({ filename: "http://localhost:5174/src/lib/api.ts?t=123#x" })
          .filename,
      ).toBe("app:///src/lib/api.ts");
      expect(normalize({ filename: "[native code]", in_app: true })).toEqual({
        filename: "[native code]",
        in_app: false,
      });
    });

    it("builds the origin from location, including non-http schemes", () => {
      expect(
        sentryAppOrigin({
          protocol: "capacitor:",
          hostname: "localhost",
          host: "localhost",
        }),
      ).toBe("capacitor://localhost");
      expect(
        sentryAppOrigin({
          protocol: "http:",
          hostname: "192.168.1.209",
          host: "192.168.1.209:8580",
        }),
      ).toBe("http://192.168.1.209:8580");
    });
  });

  describe("resolveSentryEnvironment", () => {
    const at = (url: string) => {
      const { protocol, hostname } = new URL(url);
      return { protocol, hostname };
    };

    it.each([
      "http://192.168.1.209:8580/login",
      "http://localhost:8580/",
      "http://127.0.0.1:8581/",
      "http://10.0.0.4/",
      "http://172.20.1.2:8580/",
      "http://169.254.10.1/",
      "http://100.101.102.103:8580/",
      "http://crate.local:8580/",
      "http://[::1]:8580/",
      "http://[fd12:3456::1]:8580/",
    ])("does not report a production build served from %s", (url) => {
      expect(resolveSentryEnvironment("production", at(url))).toBeNull();
      expect(isLocalNetworkHttpOrigin(at(url))).toBe(true);
    });

    it.each([
      "https://admin.lespedants.org/",
      "https://192.168.1.209:8580/",
      "http://crate.example.com/",
      "http://172.32.0.1/",
      "http://tauri.localhost/",
      "tauri://localhost/",
      "capacitor://localhost/",
      "https://localhost/",
    ])("keeps production for %s", (url) => {
      expect(resolveSentryEnvironment("production", at(url))).toBe(
        "production",
      );
    });

    it("keeps explicit non-production environments and the default", () => {
      const lan = at("http://192.168.1.209:8580/");

      expect(resolveSentryEnvironment("local", lan)).toBe("local");
      expect(resolveSentryEnvironment(undefined, lan)).toBe("development");
      expect(resolveSentryEnvironment(" ", undefined)).toBe("development");
      expect(resolveSentryEnvironment("production", undefined)).toBe(
        "production",
      );
    });
  });

  it("scrubs request data, credentials, user PII, and nested extras", () => {
    const event = scrubSentryEvent({
      request: {
        url: "https://api.example.test/api/me?token=secret",
        data: { password: "secret" },
        query_string: "token=secret",
        cookies: "session=secret",
        headers: { Authorization: "Bearer secret", Accept: "application/json" },
      },
      user: { id: 42, email: "person@example.test", ip_address: "192.0.2.1" },
      extra: { refresh_token: "secret", nested: { safe: true } },
    });

    expect(event.request).toEqual({
      url: "/api/me",
      method: undefined,
      data: undefined,
      query_string: undefined,
      cookies: undefined,
      headers: { Authorization: "[Filtered]", Accept: "application/json" },
    });
    expect(event.user).toEqual({ id: "42" });
    expect(event.extra).toEqual({
      refresh_token: "[Filtered]",
      nested: { safe: true },
    });
  });

  it("keeps only the path when URL parsing is unavailable", () => {
    expect(safeRequestPath("/api/search?q=secret")).toBe("/api/search");
  });

  it("redacts credentials, signed queries, local paths, and OAuth callbacks in error text", () => {
    const event = scrubSentryEvent({
      message:
        "Authorization: Bearer private https://api.example.test/stream?token=signed /Users/diego/music",
      exception: {
        values: [
          {
            value:
              "OAuth failed at cratemusic://callback?code=private with session_key=private",
            stacktrace: {
              frames: [
                {
                  filename: "/Users/diego/music/app.ts",
                  abs_path: "file:///Users/diego/music/app.ts",
                },
              ],
            },
          },
        ],
      },
      breadcrumbs: [
        {
          message: "GET /api/callback?state=private",
          data: {
            authorization: "Bearer private",
            cookie: "private-cookie",
          },
        },
      ],
      contexts: {
        auth: {
          refresh_token: "private-refresh",
          verifier: "private-verifier",
          sessionKey: "private-session",
        },
      },
      extra: {
        error: "refresh_token=private-refresh code=private-code",
        password: "private-password",
      },
    });

    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("signed");
    expect(serialized).not.toContain("/Users/diego");
    expect(serialized).not.toContain("private-session");
    expect(serialized).toContain("Authorization: [Filtered]");
    expect(serialized).toContain("[Filtered deep link]");
  });
});
