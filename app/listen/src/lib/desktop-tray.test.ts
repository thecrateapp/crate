import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  dispatchDesktopTrayCommand,
  syncDesktopNowPlaying,
  syncDesktopMediaSession,
  DESKTOP_TRAY_COMMAND_EVENT,
  type DesktopMediaSessionPayload,
} from "./desktop-tray";

const originalUserAgent = Object.getOwnPropertyDescriptor(
  navigator,
  "userAgent",
);

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as any).__crateTauriInvoke;
  if (originalUserAgent) {
    Object.defineProperty(navigator, "userAgent", originalUserAgent);
  }
});

describe("dispatchDesktopTrayCommand", () => {
  it("dispatches a custom event", () => {
    const handler = vi.fn();
    window.addEventListener(DESKTOP_TRAY_COMMAND_EVENT, handler);
    dispatchDesktopTrayCommand("play");
    expect(handler).toHaveBeenCalled();
    window.removeEventListener(DESKTOP_TRAY_COMMAND_EVENT, handler);
  });
});

describe("syncDesktopNowPlaying", () => {
  it("is a no-op without tauri invoke", () => {
    expect(() =>
      syncDesktopNowPlaying({ title: "Song", artist: "A", isPlaying: true }),
    ).not.toThrow();
  });

  it("calls tauri invoke when available", () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as any).__crateTauriInvoke = invoke;
    syncDesktopNowPlaying({ title: "Song", artist: "A", isPlaying: true });
    expect(invoke).toHaveBeenCalledWith("update_now_playing", {
      payload: { title: "Song", artist: "A", isPlaying: true },
    });
  });
});

describe("syncDesktopMediaSession", () => {
  it("is a no-op without tauri invoke", () => {
    const payload: DesktopMediaSessionPayload = {
      title: "Song",
      artist: "A",
      album: "Album",
      artwork: null,
      isPlaying: true,
      position: 0,
      duration: 180,
    };
    expect(() => syncDesktopMediaSession(payload)).not.toThrow();
  });

  it("calls tauri invoke with payload", () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    (window as any).__crateTauriInvoke = invoke;
    const payload: DesktopMediaSessionPayload = {
      title: "Song",
      artist: "A",
      album: "Album",
      artwork: null,
      isPlaying: true,
      position: 0,
      duration: 180,
    };
    syncDesktopMediaSession(payload);
    expect(invoke).toHaveBeenCalledWith("update_desktop_media_session", {
      payload,
    });
  });

  it.each([
    "data:image/png;base64,Y292ZXI=",
    "blob:https://listen.example/cover",
    "capacitor://localhost/_capacitor_file_/cover.jpg",
  ])(
    "materializes web-only artwork before sending %s to macOS",
    async (artwork) => {
      Object.defineProperty(navigator, "userAgent", {
        configurable: true,
        value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          }),
        ),
      );
      const invoke = vi.fn((command: string) =>
        Promise.resolve(
          command === "cache_desktop_media_artwork"
            ? "file:///tmp/crate-cover.jpg"
            : undefined,
        ),
      );
      (window as any).__crateTauriInvoke = invoke;
      const payload: DesktopMediaSessionPayload = {
        title: "Song",
        artist: "Artist",
        album: "Album",
        artwork,
        isPlaying: true,
        position: 0,
        duration: 180,
      };

      syncDesktopMediaSession(payload);

      expect(invoke).toHaveBeenCalledWith("update_desktop_media_session", {
        payload: { ...payload, artwork: null },
      });
      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("update_desktop_media_session", {
          payload: { ...payload, artwork: "file:///tmp/crate-cover.jpg" },
        });
      });
    },
  );

  it("rematerializes artwork evicted by the native cache", async () => {
    const artworkA = "data:image/png;base64,ZXZpY3RlZC1jb3Zlcg==";
    const artworkB = "data:image/png;base64,bmV3LWNvdmVy";
    const fileA = "file:///tmp/crate-evicted-cover.jpg";
    const fileB = "file:///tmp/crate-new-cover.jpg";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          }),
        ),
      ),
    );
    const cacheCalls: string[] = [];
    const invoke = vi.fn((command: string, args?: unknown) => {
      if (command !== "cache_desktop_media_artwork") {
        return Promise.resolve(undefined);
      }
      const cacheKey = (args as { cacheKey: string }).cacheKey;
      cacheCalls.push(cacheKey);
      return Promise.resolve(
        cacheKey === artworkB
          ? { url: fileB, evictedUrls: [fileA] }
          : { url: fileA, evictedUrls: [] },
      );
    });
    (window as any).__crateTauriInvoke = invoke;
    const payload = (artwork: string): DesktopMediaSessionPayload => ({
      title: artwork,
      artist: "Artist",
      album: "Album",
      artwork,
      isPlaying: true,
      position: 0,
      duration: 180,
    });

    syncDesktopMediaSession(payload(artworkA));
    await vi.waitFor(() => expect(cacheCalls).toEqual([artworkA]));
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("update_desktop_media_session", {
        payload: { ...payload(artworkA), artwork: fileA },
      }),
    );
    syncDesktopMediaSession(payload(artworkB));
    await vi.waitFor(() => expect(cacheCalls).toEqual([artworkA, artworkB]));
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("update_desktop_media_session", {
        payload: { ...payload(artworkB), artwork: fileB },
      }),
    );
    syncDesktopMediaSession(payload(artworkA));

    await vi.waitFor(() =>
      expect(cacheCalls).toEqual([artworkA, artworkB, artworkA]),
    );
  });

  it("does not restore an evicted artwork from an older pending request", async () => {
    const artworkA = "data:image/png;base64,b2xkLXBlbmRpbmc=";
    const artworkB = "data:image/png;base64,bmV3LXBlbmRpbmc=";
    const fileA = "file:///tmp/crate-old-pending.jpg";
    const fileB = "file:///tmp/crate-new-pending.jpg";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          }),
        ),
      ),
    );
    let resolveA: (value: unknown) => void = () => undefined;
    let resolveB: (value: unknown) => void = () => undefined;
    const resultA = new Promise((resolve) => {
      resolveA = resolve;
    });
    const resultB = new Promise((resolve) => {
      resolveB = resolve;
    });
    const cacheCalls: string[] = [];
    const invoke = vi.fn((command: string, args?: unknown) => {
      if (command !== "cache_desktop_media_artwork") {
        return Promise.resolve(undefined);
      }
      const cacheKey = (args as { cacheKey: string }).cacheKey;
      cacheCalls.push(cacheKey);
      if (cacheCalls.filter((key) => key === artworkA).length > 1) {
        return Promise.resolve({ url: fileA, evictedUrls: [] });
      }
      return cacheKey === artworkA ? resultA : resultB;
    });
    (window as any).__crateTauriInvoke = invoke;
    const payload = (artwork: string): DesktopMediaSessionPayload => ({
      title: artwork,
      artist: "Artist",
      album: "Album",
      artwork,
      isPlaying: true,
      position: 0,
      duration: 180,
    });

    syncDesktopMediaSession(payload(artworkA));
    await vi.waitFor(() => expect(cacheCalls).toEqual([artworkA]));
    syncDesktopMediaSession(payload(artworkB));
    await vi.waitFor(() => expect(cacheCalls).toEqual([artworkA, artworkB]));
    resolveB({ url: fileB, evictedUrls: [fileA] });
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("update_desktop_media_session", {
        payload: { ...payload(artworkB), artwork: fileB },
      }),
    );
    resolveA({ url: fileA, evictedUrls: [] });
    await Promise.resolve();
    await Promise.resolve();
    syncDesktopMediaSession(payload(artworkA));

    await vi.waitFor(() =>
      expect(cacheCalls).toEqual([artworkA, artworkB, artworkA]),
    );
  });
});
