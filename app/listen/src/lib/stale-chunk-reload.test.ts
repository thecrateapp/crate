import { afterEach, describe, expect, it, vi } from "vitest";

const { handlePreloadError, isReloadPending, createStaleChunkReloader } =
  vi.hoisted(() => {
    const handlePreloadError = vi.fn();
    const isReloadPending = vi.fn(() => false);
    return {
      handlePreloadError,
      isReloadPending,
      createStaleChunkReloader: vi.fn(() => ({
        handlePreloadError,
        isReloadPending,
      })),
    };
  });

vi.mock("../../../shared/web/stale-chunk-reload", () => ({
  browserSessionStorage: () => window.sessionStorage,
  createStaleChunkReloader,
}));

import {
  installStaleChunkReload,
  isStaleChunkReloadPending,
} from "./stale-chunk-reload";

describe("Listen stale-chunk reload", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("guards reloads with sessionStorage", () => {
    expect(createStaleChunkReloader).toHaveBeenCalledWith(
      expect.objectContaining({
        storage: window.sessionStorage,
        reload: expect.any(Function),
      }),
    );
  });

  it("handles Vite preload errors until disposed", () => {
    const dispose = installStaleChunkReload(window);
    const event = new Event("vite:preloadError", { cancelable: true });

    window.dispatchEvent(event);
    dispose();
    window.dispatchEvent(new Event("vite:preloadError"));

    expect(handlePreloadError).toHaveBeenCalledOnce();
    expect(handlePreloadError).toHaveBeenCalledWith(event);
  });

  it("exposes the pending state Sentry uses to drop events", () => {
    isReloadPending.mockReturnValueOnce(true);

    expect(isStaleChunkReloadPending()).toBe(true);
  });
});
