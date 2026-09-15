import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  initSentry,
  captureRuntimeError,
  initNativeSentry,
  captureNativeRuntimeError,
} = vi.hoisted(() => ({
  initSentry: vi.fn(() => Promise.resolve()),
  captureRuntimeError: vi.fn(() => Promise.resolve()),
  initNativeSentry: vi.fn(),
  captureNativeRuntimeError: vi.fn(),
}));

vi.mock("./sentry", () => ({ initSentry, captureRuntimeError }));
vi.mock("./sentry-capacitor", () => ({
  initNativeSentry,
  captureNativeRuntimeError,
}));

import { initRuntimeSentry, reportRuntimeError } from "./runtime-sentry";

describe("runtime Sentry routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("awaits the web SDK initialization before bootstrap", async () => {
    await initRuntimeSentry(false);

    expect(initSentry).toHaveBeenCalledOnce();
    expect(initNativeSentry).not.toHaveBeenCalled();
  });

  it("loads the native SDK for Capacitor", async () => {
    await initRuntimeSentry(true);

    expect(initNativeSentry).toHaveBeenCalledOnce();
    expect(initSentry).not.toHaveBeenCalled();
  });

  it("reports web runtime failures through the web SDK", async () => {
    const error = new Error("web failure");

    await reportRuntimeError(error, "bootstrap.unhandled", false);

    expect(captureRuntimeError).toHaveBeenCalledWith(
      error,
      "bootstrap.unhandled",
    );
    expect(captureNativeRuntimeError).not.toHaveBeenCalled();
  });

  it("reports Capacitor failures through the native SDK", async () => {
    const error = new Error("native failure");

    await reportRuntimeError(error, "bootstrap.unhandled", true);

    expect(captureNativeRuntimeError).toHaveBeenCalledWith(
      error,
      "bootstrap.unhandled",
    );
    expect(captureRuntimeError).not.toHaveBeenCalled();
  });
});
