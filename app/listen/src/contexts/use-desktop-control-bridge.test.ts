import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api,
}));
const { prefetchLauncherArt } = vi.hoisted(() => ({
  prefetchLauncherArt: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/desktop-launcher-art", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/desktop-launcher-art")>()),
  prefetchLauncherArt,
}));
vi.mock("@/lib/remote-track-playback", () => ({
  resolveRemotePlayableTrack: (track: unknown) => Promise.resolve(track),
}));

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/platform")>()),
  isTauriRuntime: true,
}));

import {
  DESKTOP_CONTROL_COMMAND_EVENT,
  resetDesktopControlStateForTests,
} from "@/lib/desktop-control";

import { useDesktopControlBridge } from "./use-desktop-control-bridge";

function input() {
  return {
    addToQueue: vi.fn(),
    jamQueueLocked: false,
    play: vi.fn(),
    playAll: vi.fn(),
    repeat: "off" as const,
    seek: vi.fn(),
    setRepeatMode: vi.fn(),
    setVolume: vi.fn(),
    shuffle: false,
    toggleShuffle: vi.fn(),
    volume: 0.5,
  };
}

describe("useDesktopControlBridge", () => {
  beforeEach(() => {
    resetDesktopControlStateForTests();
    localStorage.clear();
    window.__crateTauriInvoke = vi.fn().mockResolvedValue(undefined);
  });
  afterEach(() => {
    delete window.__crateTauriInvoke;
  });

  it("publishes the player and equalizer state to the shell", () => {
    renderHook(() => useDesktopControlBridge(input()));
    expect(window.__crateTauriInvoke).toHaveBeenCalledWith(
      "update_desktop_control_state",
      {
        state: expect.objectContaining({
          player: { volume: 0.5, shuffle: false, repeat: "off" },
          eq: expect.objectContaining({
            mode: expect.any(String),
            gains: expect.any(Array),
          }),
        }),
      },
    );
  });

  it("applies relayed commands to the player", () => {
    const value = input();
    renderHook(() => useDesktopControlBridge(value));
    act(() => {
      window.dispatchEvent(
        new CustomEvent(DESKTOP_CONTROL_COMMAND_EVENT, {
          detail: { cmd: "set_volume", volume: 0.25 },
        }),
      );
      window.dispatchEvent(
        new CustomEvent(DESKTOP_CONTROL_COMMAND_EVENT, {
          detail: { cmd: "set_shuffle", on: true },
        }),
      );
      window.dispatchEvent(
        new CustomEvent(DESKTOP_CONTROL_COMMAND_EVENT, {
          detail: { cmd: "quit" },
        }),
      );
    });
    expect(value.setVolume).toHaveBeenCalledWith(0.25);
    expect(value.toggleShuffle).toHaveBeenCalledTimes(1);
  });

  it("changes the stored equalizer mode", () => {
    renderHook(() => useDesktopControlBridge(input()));
    act(() => {
      window.dispatchEvent(
        new CustomEvent(DESKTOP_CONTROL_COMMAND_EVENT, {
          detail: { cmd: "eq_mode", mode: "genre" },
        }),
      );
    });
    expect(localStorage.getItem("listen-eq-genre-adaptive")).toBe("true");
    expect(localStorage.getItem("listen-eq-enabled")).toBe("true");
  });

  it("answers a search with the results and plays a picked track", async () => {
    api.mockResolvedValue({
      artists: [{ name: "Repion", id: 3 }],
      albums: [],
      tracks: [
        {
          id: 9,
          title: "Barrio Somavilla",
          artist: "Repion",
          album: "Pronto",
          path: "a.flac",
        },
      ],
    });
    const value = input();
    renderHook(() => useDesktopControlBridge(value));
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(DESKTOP_CONTROL_COMMAND_EVENT, {
          detail: { cmd: "search", query: "repion", request: 5 },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(api).toHaveBeenCalledWith("/api/catalog/search?q=repion&limit=8");
    const reply = (
      window.__crateTauriInvoke as ReturnType<typeof vi.fn>
    ).mock.calls.find(([name]) => name === "desktop_control_reply");
    expect(reply?.[1].request).toBe(5);
    const items = reply?.[1].items as { kind: string; ref: unknown }[];
    expect(items.map((i) => i.kind)).toEqual(["artist", "track"]);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(DESKTOP_CONTROL_COMMAND_EVENT, {
          detail: { cmd: "play_item", item: items[1]?.ref },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(value.play).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Barrio Somavilla" }),
      { type: "queue", name: "Search" },
    );
  });

  it("fetches the art the shell reports missing after answering", async () => {
    api.mockResolvedValue({
      artists: [],
      albums: [{ name: "Pronto", artist: "Repion", id: 11 }],
      tracks: [],
    });
    window.__crateTauriInvoke = vi.fn((name: string) =>
      Promise.resolve(
        name === "desktop_control_reply"
          ? { delivered: true, missingArt: ["album:11"] }
          : undefined,
      ),
    ) as typeof window.__crateTauriInvoke;
    renderHook(() => useDesktopControlBridge(input()));
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(DESKTOP_CONTROL_COMMAND_EVENT, {
          detail: { cmd: "search", query: "pronto", request: 6 },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const reply = (
      window.__crateTauriInvoke as ReturnType<typeof vi.fn>
    ).mock.calls.find(([name]) => name === "desktop_control_reply");
    expect(reply?.[1].items[0].art_key).toBe("album:11");
    expect(prefetchLauncherArt).toHaveBeenCalledWith(
      ["album:11"],
      expect.objectContaining({ store: expect.any(Function) }),
    );
  });

  it("queues a picked item and confirms it to the shell", async () => {
    const value = input();
    renderHook(() => useDesktopControlBridge(value));
    const item = {
      kind: "track",
      track: {
        id: 9,
        title: "Barrio Somavilla",
        artist: "Repion",
        album: "Pronto",
      },
    };
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(DESKTOP_CONTROL_COMMAND_EVENT, {
          detail: { cmd: "queue_item", item, request: 8 },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(value.addToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Barrio Somavilla" }),
    );
    expect(window.__crateTauriInvoke).toHaveBeenCalledWith(
      "desktop_control_done",
      { request: 8, error: null },
    );
  });

  it("reports why an item could not be queued", async () => {
    const value = { ...input(), jamQueueLocked: true };
    renderHook(() => useDesktopControlBridge(value));
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(DESKTOP_CONTROL_COMMAND_EVENT, {
          detail: {
            cmd: "queue_item",
            item: { kind: "track", track: { title: "x", artist: "y" } },
            request: 9,
          },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(value.addToQueue).not.toHaveBeenCalled();
    expect(window.__crateTauriInvoke).toHaveBeenCalledWith(
      "desktop_control_done",
      { request: 9, error: "The queue is locked by a Jam session" },
    );
  });
});
