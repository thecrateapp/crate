import { describe, expect, it, vi } from "vitest";

const {
  capacitorInit,
  reactInit,
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
    capacitorInit: vi.fn(),
    reactInit: vi.fn(),
    rewriteFramesIntegration: vi.fn(() => "rewrite-frames"),
    captureException: vi.fn(),
    setFingerprint,
    setTag,
    withScope: vi.fn((callback: (scope: unknown) => void) =>
      callback({ setFingerprint, setTag }),
    ),
    browserTracingIntegration: vi.fn(() => "browser-tracing"),
  };
});

vi.mock("@sentry/capacitor", () => ({
  init: capacitorInit,
  captureException,
  withScope,
  browserTracingIntegration,
}));

vi.mock("@sentry/react", () => ({
  init: reactInit,
  rewriteFramesIntegration,
}));

import {
  captureNativeRuntimeError,
  initNativeSentry,
} from "./sentry-capacitor";

describe("Capacitor Sentry setup", () => {
  it("initializes the native SDK with the React sibling SDK", () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://public@example.test/native");

    initNativeSentry();

    expect(capacitorInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public@example.test/native",
        enableNative: true,
        enableNativeCrashHandling: true,
        enableCaptureFailedRequests: true,
        sendDefaultPii: false,
        integrations: ["browser-tracing", "rewrite-frames"],
        beforeSend: expect.any(Function),
      }),
      reactInit,
    );
    // Replaces the Capacitor SDK's own RewriteFrames so Android
    // (https://localhost) and iOS frames share the app:/// prefix.
    const [{ iteratee }] = rewriteFramesIntegration.mock
      .calls[0] as unknown as [
      { iteratee: (frame: { filename: string }) => { filename: string } },
    ];
    expect(
      iteratee({ filename: `${window.location.origin}/assets/index-x.js` })
        .filename,
    ).toBe("app:///assets/index-x.js");
    const { beforeSend } = capacitorInit.mock.calls[0]![0] as {
      beforeSend: (
        event: Record<string, unknown>,
        hint?: { originalException?: unknown },
      ) => unknown;
    };
    expect(
      beforeSend({}, { originalException: new TypeError("Load failed") }),
    ).toBeNull();
  });

  it("groups native runtime failures by operation", () => {
    const error = new Error("native bridge failed");

    captureNativeRuntimeError(error, "capacitor.initialize");

    expect(withScope).toHaveBeenCalledOnce();
    expect(setTag).toHaveBeenCalledWith(
      "runtime.operation",
      "capacitor.initialize",
    );
    expect(setTag).toHaveBeenCalledWith("runtime.platform", "capacitor");
    expect(setFingerprint).toHaveBeenCalledWith([
      "listen-runtime-error",
      "capacitor.initialize",
      "{{ default }}",
    ]);
    expect(captureException).toHaveBeenCalledWith(error);
  });
});
