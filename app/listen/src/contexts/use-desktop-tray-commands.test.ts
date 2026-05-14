import { renderHook } from "@testing-library/react";
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

    delete window.__crateTauriInvoke;
  });
});
