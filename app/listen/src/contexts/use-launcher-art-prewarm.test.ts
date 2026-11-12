import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Track } from "@/contexts/player-types";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api,
}));
vi.mock("@/hooks/listen-warmup-runner", () => ({
  scheduleWarmup: (callback: () => void) => {
    callback();
    return () => {};
  },
}));
const { platform } = vi.hoisted(() => ({ platform: { tauri: true } }));
vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  get isTauriRuntime() {
    return platform.tauri;
  },
}));

import { resetLauncherArtForTests } from "@/lib/desktop-launcher-art";

import {
  QUEUE_PREWARM_DELAY_MS,
  useLauncherArtPrewarm,
} from "./use-launcher-art-prewarm";

function track(id: string, albumId: number, artistId: number): Track {
  return {
    id,
    title: id,
    artist: `R${artistId}`,
    artistId,
    album: `A${albumId}`,
    albumId,
  } as Track;
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });

function missingCalls(): string[][] {
  return vi
    .mocked(window.__crateTauriInvoke!)
    .mock.calls.filter(([name]) => name === "launcher_art_missing")
    .map(([, args]) => (args as { keys: string[] }).keys);
}

describe("useLauncherArtPrewarm", () => {
  beforeEach(() => {
    platform.tauri = true;
    api.mockReset();
    resetLauncherArtForTests();
    api.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith("/api/me/history")
          ? [
              {
                title: "x",
                artist: "R5",
                artist_id: 5,
                album: "A50",
                album_id: 50,
              },
            ]
          : [],
      ),
    );
    window.__crateTauriInvoke = vi.fn((name: string) =>
      Promise.resolve(name === "launcher_art_missing" ? [] : true),
    ) as typeof window.__crateTauriInvoke;
  });
  afterEach(() => {
    vi.useRealTimers();
    delete window.__crateTauriInvoke;
  });

  it("warms what the user played once the app starts", async () => {
    renderHook(() =>
      useLauncherArtPrewarm({ currentTrack: undefined, queue: [] }),
    );
    await flush();
    expect(api).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/me\/history\?limit=/),
    );
    expect(missingCalls()).toContainEqual(["album:50", "artist:5"]);
  });

  it("skips the startup fetches where the shell has no launcher cache", async () => {
    window.__crateTauriInvoke = vi.fn(() =>
      Promise.resolve(null),
    ) as typeof window.__crateTauriInvoke;
    renderHook(() =>
      useLauncherArtPrewarm({ currentTrack: undefined, queue: [] }),
    );
    await flush();
    expect(api).not.toHaveBeenCalled();
  });

  it("warms a new track's album and artist when it starts", async () => {
    const { rerender } = renderHook(
      ({ current }) =>
        useLauncherArtPrewarm({ currentTrack: current, queue: [] }),
      { initialProps: { current: track("a", 1, 2) } },
    );
    await flush();
    expect(missingCalls()).toContainEqual(["album:1", "artist:2"]);
    rerender({ current: track("b", 3, 4) });
    await flush();
    expect(missingCalls()).toContainEqual(["album:3", "artist:4"]);
    const before = missingCalls().length;
    rerender({ current: { ...track("b", 3, 4) } });
    await flush();
    expect(missingCalls()).toHaveLength(before);
  });

  it("warms the queue after it settles", async () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(
      ({ queue }) => useLauncherArtPrewarm({ currentTrack: undefined, queue }),
      { initialProps: { queue: [] as Track[] } },
    );
    rerender({ queue: [track("a", 7, 8)] });
    rerender({ queue: [track("a", 7, 8), track("b", 9, 8)] });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(QUEUE_PREWARM_DELAY_MS);
    });
    const queueCalls = missingCalls().filter((keys) =>
      keys.includes("album:9"),
    );
    expect(queueCalls).toEqual([["album:7", "artist:8", "album:9"]]);
  });

  it("stays off outside the desktop app", async () => {
    platform.tauri = false;
    renderHook(() =>
      useLauncherArtPrewarm({ currentTrack: track("a", 1, 2), queue: [] }),
    );
    await flush();
    expect(window.__crateTauriInvoke).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
  });
});
