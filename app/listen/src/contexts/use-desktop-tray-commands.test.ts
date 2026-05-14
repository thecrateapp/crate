import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  useDesktopTrayCommands,
  useDesktopTrayNowPlaying,
} from "@/contexts/use-desktop-tray-commands";
import {
  dispatchDesktopTrayCommand,
  syncDesktopMediaSession,
} from "@/lib/desktop-tray";

function setup(isPlaying = false) {
  const controls = {
    isPlayingRef: { current: isPlaying },
    pause: vi.fn(),
    resume: vi.fn(),
    previous: vi.fn(),
    next: vi.fn(),
  };
  renderHook(() => useDesktopTrayCommands(controls));
  return controls;
}

function setUserAgent(value: string): string {
  const originalUserAgent = window.navigator.userAgent;
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value,
  });
  return originalUserAgent;
}

describe("useDesktopTrayCommands", () => {
  it("resumes from the tray when playback is paused", () => {
    const controls = setup(false);

    dispatchDesktopTrayCommand("play_pause");

    expect(controls.resume).toHaveBeenCalledTimes(1);
    expect(controls.pause).not.toHaveBeenCalled();
  });

  it("pauses from the tray when playback is active", () => {
    const controls = setup(true);

    dispatchDesktopTrayCommand("play_pause");

    expect(controls.pause).toHaveBeenCalledTimes(1);
    expect(controls.resume).not.toHaveBeenCalled();
  });

  it("routes explicit play and pause commands", () => {
    const controls = setup(false);

    dispatchDesktopTrayCommand("play");
    dispatchDesktopTrayCommand("pause");

    expect(controls.resume).toHaveBeenCalledTimes(1);
    expect(controls.pause).toHaveBeenCalledTimes(1);
  });

  it("routes previous and next tray commands", () => {
    const controls = setup(false);

    dispatchDesktopTrayCommand("previous");
    dispatchDesktopTrayCommand("next");

    expect(controls.previous).toHaveBeenCalledTimes(1);
    expect(controls.next).toHaveBeenCalledTimes(1);
  });
});

describe("useDesktopTrayNowPlaying", () => {
  it("syncs current track metadata with the desktop shell", () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    window.__crateTauriInvoke = invoke;

    renderHook(() =>
      useDesktopTrayNowPlaying({
        currentTrack: {
          id: "track-1",
          title: "Minerva",
          artist: "Deftones",
        },
        isPlaying: true,
      }),
    );

    expect(invoke).toHaveBeenCalledWith("update_now_playing", {
      payload: {
        title: "Minerva",
        artist: "Deftones",
        isPlaying: true,
      },
    });

    delete window.__crateTauriInvoke;
  });

  it("syncs rich media session metadata with the desktop shell", () => {
    const originalUserAgent = setUserAgent("Mozilla/5.0 Mac OS X");
    const invoke = vi.fn().mockResolvedValue(undefined);
    window.__crateTauriInvoke = invoke;

    syncDesktopMediaSession({
      title: "Minerva",
      artist: "Deftones",
      album: "Deftones",
      artwork: "https://api.example.test/cover.jpg",
      isPlaying: true,
      position: 12,
      duration: 260,
    });

    expect(invoke).toHaveBeenCalledWith("update_desktop_media_session", {
      payload: {
        title: "Minerva",
        artist: "Deftones",
        album: "Deftones",
        artwork: "https://api.example.test/cover.jpg",
        isPlaying: true,
        position: 12,
        duration: 260,
      },
    });

    setUserAgent(originalUserAgent);
    delete window.__crateTauriInvoke;
  });

  it("caches Linux MPRIS artwork as a local file URL", async () => {
    const originalUserAgent = setUserAgent("Mozilla/5.0 Linux x86_64");

    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? "image/jpeg" : null,
      },
      blob: async () => ({
        size: 3,
        type: "image/jpeg",
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }),
    });
    vi.stubGlobal("fetch", fetch);

    const invoke = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce("file:///tmp/crate-cover.jpg")
      .mockResolvedValueOnce(undefined);
    window.__crateTauriInvoke = invoke;

    syncDesktopMediaSession({
      title: "Minerva",
      artist: "Deftones",
      album: "Deftones",
      artwork: "https://api.example.test/cover.jpg?token=secret",
      isPlaying: true,
      position: 12,
      duration: 260,
    });

    expect(invoke).toHaveBeenCalledWith("update_desktop_media_session", {
      payload: {
        title: "Minerva",
        artist: "Deftones",
        album: "Deftones",
        artwork: null,
        isPlaying: true,
        position: 12,
        duration: 260,
      },
    });

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("cache_desktop_media_artwork", {
        cacheKey: "https://api.example.test/cover.jpg?token=secret",
        bytes: [1, 2, 3],
        mimeType: "image/jpeg",
      });
    });
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith("update_desktop_media_session", {
        payload: {
          title: "Minerva",
          artist: "Deftones",
          album: "Deftones",
          artwork: "file:///tmp/crate-cover.jpg",
          isPlaying: true,
          position: 12,
          duration: 260,
        },
      });
    });

    setUserAgent(originalUserAgent);
    vi.unstubAllGlobals();
    delete window.__crateTauriInvoke;
  });
});
