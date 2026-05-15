import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  dispatchDesktopTrayCommand,
  syncDesktopNowPlaying,
  syncDesktopMediaSession,
  DESKTOP_TRAY_COMMAND_EVENT,
  type DesktopMediaSessionPayload,
} from "./desktop-tray";

beforeEach(() => {
  vi.restoreAllMocks();
  delete (window as any).__crateTauriInvoke;
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
});
