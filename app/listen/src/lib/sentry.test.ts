import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  init,
  setUser,
  captureException,
  setFingerprint,
  setTag,
  withScope,
  browserTracingIntegration,
} = vi.hoisted(() => {
  const setFingerprint = vi.fn();
  const setTag = vi.fn();

  return {
    init: vi.fn(),
    setUser: vi.fn(),
    captureException: vi.fn(),
    setFingerprint,
    setTag,
    withScope: vi.fn((callback: (scope: unknown) => void) =>
      callback({ setFingerprint, setTag }),
    ),
    browserTracingIntegration: vi.fn(() => "browser-tracing"),
  };
});

vi.mock("@sentry/react", () => ({
  init,
  setUser,
  captureException,
  withScope,
  browserTracingIntegration,
}));

import { captureRuntimeError, initSentry, setSentryUser } from "./sentry";

describe("Listen Sentry setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      }),
    );
  });

  it("clears the stable user id on logout", async () => {
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
