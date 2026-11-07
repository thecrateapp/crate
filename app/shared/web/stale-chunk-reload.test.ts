import { describe, expect, it, vi } from "vitest";

import {
  STALE_CHUNK_RELOAD_KEY,
  STALE_CHUNK_RETRY_WINDOW_MS,
  browserSessionStorage,
  createStaleChunkReloader,
  type StaleChunkReloadStorage,
} from "./stale-chunk-reload";

function memoryStorage(): StaleChunkReloadStorage & {
  values: Map<string, string>;
} {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function preloadError(): Event {
  return new Event("vite:preloadError", { cancelable: true });
}

function setup(storage: StaleChunkReloadStorage | null = memoryStorage()) {
  let now = 1_000_000;
  const reload = vi.fn();
  const reloader = createStaleChunkReloader({
    storage,
    reload,
    now: () => now,
  });
  return {
    reloader,
    reload,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("createStaleChunkReloader", () => {
  it("reloads once and keeps the stale-chunk error out of Sentry", () => {
    const storage = memoryStorage();
    const { reloader, reload } = setup(storage);
    const event = preloadError();

    reloader.handlePreloadError(event);

    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(storage.values.get(STALE_CHUNK_RELOAD_KEY)).toBe("1000000");
    expect(reloader.isReloadPending()).toBe(true);
  });

  it("swallows other chunk failures while the reload is underway", () => {
    const { reloader, reload } = setup();
    reloader.handlePreloadError(preloadError());
    const second = preloadError();

    reloader.handlePreloadError(second);

    expect(second.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("lets the error through when the page reloaded for it recently", () => {
    const storage = memoryStorage();
    storage.setItem(STALE_CHUNK_RELOAD_KEY, String(1_000_000 - 5_000));
    const { reloader, reload } = setup(storage);
    const event = preloadError();

    reloader.handlePreloadError(event);

    expect(event.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(reloader.isReloadPending()).toBe(false);
  });

  it("reloads again once the retry window has passed", () => {
    const storage = memoryStorage();
    storage.setItem(
      STALE_CHUNK_RELOAD_KEY,
      String(1_000_000 - STALE_CHUNK_RETRY_WINDOW_MS),
    );
    const { reloader, reload } = setup(storage);
    const event = preloadError();

    reloader.handlePreloadError(event);

    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("stops suppressing once the reload window expires", () => {
    const { reloader, advance } = setup();
    reloader.handlePreloadError(preloadError());

    advance(10_000);

    expect(reloader.isReloadPending()).toBe(false);
  });

  it("does not reload without storage to guard against loops", () => {
    const throwing: StaleChunkReloadStorage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };

    for (const storage of [null, throwing]) {
      const { reloader, reload } = setup(storage);
      const event = preloadError();

      reloader.handlePreloadError(event);

      expect(event.defaultPrevented).toBe(false);
      expect(reload).not.toHaveBeenCalled();
    }
  });

  it("uses sessionStorage when the browser allows it", () => {
    expect(browserSessionStorage()).toBe(window.sessionStorage);
  });
});
