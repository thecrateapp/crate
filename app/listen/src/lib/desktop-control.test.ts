import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyDesktopControlCommand,
  buildDesktopControlState,
  eqModeOf,
  getResolvedEqualizer,
  parseDesktopControlCommand,
  publishDesktopControlState,
  reportResolvedEqualizer,
  resetDesktopControlStateForTests,
  subscribeResolvedEqualizer,
  type DesktopControlActions,
} from "./desktop-control";
import type { EqualizerSnapshot } from "./equalizer-prefs";

const FLAT = new Array(10).fill(0);

function snapshot(over: Partial<EqualizerSnapshot> = {}): EqualizerSnapshot {
  return {
    enabled: true,
    preset: "flat",
    gains: FLAT,
    smart: false,
    adaptive: false,
    genreAdaptive: false,
    ...over,
  };
}

function actions(shuffle = false) {
  const eq = {
    setEnabled: vi.fn(),
    setSmart: vi.fn(),
    setAdaptive: vi.fn(),
    setGenreAdaptive: vi.fn(),
    applyPreset: vi.fn(),
    setCustomGains: vi.fn(),
  };
  const value: DesktopControlActions = {
    seek: vi.fn(),
    setVolume: vi.fn(),
    shuffle,
    toggleShuffle: vi.fn(),
    setRepeatMode: vi.fn(),
    eq,
  };
  return { value, eq };
}

afterEach(() => resetDesktopControlStateForTests());

const ALBUM_REF = {
  kind: "album",
  album: { album: "Pronto", artist: "Repion", albumId: 11 },
} as const;

describe("parseDesktopControlCommand", () => {
  it("accepts every command with valid arguments", () => {
    expect(parseDesktopControlCommand({ cmd: "seek", position: 42 })).toEqual({
      cmd: "seek",
      position: 42,
    });
    expect(
      parseDesktopControlCommand({ cmd: "set_repeat", mode: "one" }),
    ).toEqual({
      cmd: "set_repeat",
      mode: "one",
    });
    expect(
      parseDesktopControlCommand({ cmd: "eq_mode", mode: "genre" }),
    ).toEqual({
      cmd: "eq_mode",
      mode: "genre",
    });
    expect(
      parseDesktopControlCommand({ cmd: "eq_preset", preset: "shoegaze" }),
    ).toEqual({
      cmd: "eq_preset",
      preset: "shoegaze",
    });
  });

  it("accepts queue_item with a request id and show with an item", () => {
    expect(
      parseDesktopControlCommand({
        cmd: "queue_item",
        item: ALBUM_REF,
        request: 4,
      }),
    ).toEqual({ cmd: "queue_item", item: ALBUM_REF, request: 4 });
    expect(
      parseDesktopControlCommand({ cmd: "show", item: ALBUM_REF }),
    ).toEqual({ cmd: "show", item: ALBUM_REF });
  });

  it("clamps volume and gains into range", () => {
    expect(
      parseDesktopControlCommand({ cmd: "set_volume", volume: 3 }),
    ).toEqual({
      cmd: "set_volume",
      volume: 1,
    });
    const gains = [20, -20, 0, 0, 0, 0, 0, 0, 0, 1.5];
    expect(parseDesktopControlCommand({ cmd: "eq_gains", gains })).toEqual({
      cmd: "eq_gains",
      gains: [12, -12, 0, 0, 0, 0, 0, 0, 0, 1.5],
    });
  });

  it("drops unknown or malformed commands", () => {
    for (const value of [
      null,
      "play",
      { cmd: "quit" },
      { cmd: "seek", position: -1 },
      { cmd: "seek", position: Number.NaN },
      { cmd: "set_shuffle", on: "yes" },
      { cmd: "set_repeat", mode: "forever" },
      { cmd: "eq_mode", mode: "loud" },
      { cmd: "eq_preset", preset: "__proto__" },
      { cmd: "eq_preset", preset: "not-a-preset" },
      { cmd: "eq_gains", gains: [1, 2, 3] },
      { cmd: "eq_gains", gains: new Array(10).fill("1") },
      { cmd: "queue_item", item: ALBUM_REF },
      { cmd: "queue_item", item: ALBUM_REF, request: 0 },
      { cmd: "queue_item", item: { kind: "playlist" }, request: 1 },
      { cmd: "show" },
      { cmd: "show", item: { kind: "genre" } },
    ]) {
      expect(
        parseDesktopControlCommand(value),
        JSON.stringify(value),
      ).toBeNull();
    }
  });
});

describe("applyDesktopControlCommand", () => {
  it("routes player commands", () => {
    const { value } = actions(false);
    applyDesktopControlCommand({ cmd: "seek", position: 10 }, value);
    applyDesktopControlCommand({ cmd: "set_volume", volume: 0.4 }, value);
    applyDesktopControlCommand({ cmd: "set_repeat", mode: "all" }, value);
    expect(value.seek).toHaveBeenCalledWith(10);
    expect(value.setVolume).toHaveBeenCalledWith(0.4);
    expect(value.setRepeatMode).toHaveBeenCalledWith("all");
  });

  it("toggles shuffle only when the requested state differs", () => {
    const off = actions(false);
    applyDesktopControlCommand({ cmd: "set_shuffle", on: false }, off.value);
    expect(off.value.toggleShuffle).not.toHaveBeenCalled();
    applyDesktopControlCommand({ cmd: "set_shuffle", on: true }, off.value);
    expect(off.value.toggleShuffle).toHaveBeenCalledTimes(1);
  });

  it("switches EQ modes and turns the EQ on", () => {
    const { value, eq } = actions();
    applyDesktopControlCommand({ cmd: "eq_mode", mode: "smart" }, value);
    expect(eq.setEnabled).toHaveBeenLastCalledWith(true);
    expect(eq.setSmart).toHaveBeenCalledWith(true);

    applyDesktopControlCommand({ cmd: "eq_mode", mode: "genre" }, value);
    expect(eq.setGenreAdaptive).toHaveBeenCalledWith(true);

    applyDesktopControlCommand({ cmd: "eq_mode", mode: "manual" }, value);
    expect(eq.setSmart).toHaveBeenLastCalledWith(false);
    expect(eq.setAdaptive).toHaveBeenLastCalledWith(false);
    expect(eq.setGenreAdaptive).toHaveBeenLastCalledWith(false);

    applyDesktopControlCommand({ cmd: "eq_preset", preset: "rock" }, value);
    expect(eq.applyPreset).toHaveBeenCalledWith("rock");

    applyDesktopControlCommand({ cmd: "eq_enabled", on: false }, value);
    expect(eq.setEnabled).toHaveBeenLastCalledWith(false);
  });
});

describe("desktop control state", () => {
  it("names the active mode with the runtime's priority", () => {
    expect(eqModeOf(snapshot({ smart: true, adaptive: true }))).toBe("smart");
    expect(eqModeOf(snapshot({ adaptive: true, genreAdaptive: true }))).toBe(
      "adaptive",
    );
    expect(eqModeOf(snapshot({ genreAdaptive: true }))).toBe("genre");
    expect(eqModeOf(snapshot())).toBe("manual");
  });

  it("publishes resolved gains, source and detail for the active mode", () => {
    const gains = [1.26, 2, 3, 0, 0, 0, 0, 0, -1, -2];
    const state = buildDesktopControlState({
      volume: 0.756,
      shuffle: true,
      repeat: "one",
      snapshot: snapshot({ smart: true }),
      resolved: {
        mode: "smart",
        gains,
        source: "genre_taxonomy_preset",
        detail: "Post-Rock",
      },
    });
    expect(state.player).toEqual({
      volume: 0.76,
      shuffle: true,
      repeat: "one",
    });
    expect(state.eq.mode).toBe("smart");
    expect(state.eq.gains[0]).toBe(1.3);
    expect(state.eq.source).toBe("genre_taxonomy_preset");
    expect(state.eq.detail).toBe("Post-Rock");
    expect(state.eq.bands).toEqual([
      "32",
      "64",
      "125",
      "250",
      "500",
      "1K",
      "2K",
      "4K",
      "8K",
      "16K",
    ]);
    expect(state.eq.presets).toContain("shoegaze");
  });

  it("drops a source and detail resolved for the previous mode", () => {
    const state = buildDesktopControlState({
      volume: 1,
      shuffle: false,
      repeat: "off",
      snapshot: snapshot({ genreAdaptive: true }),
      resolved: {
        mode: "smart",
        gains: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        source: "genre_taxonomy_preset",
        detail: "Genre: alternative",
      },
    });
    expect(state.eq.mode).toBe("genre");
    expect(state.eq.source).toBeNull();
    expect(state.eq.detail).toBeNull();
    expect(state.eq.gains).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("uses the stored gains until the runtime has resolved a curve", () => {
    const stored = [3, 3, 3, 0, 0, 0, 0, 0, 0, 0];
    const state = buildDesktopControlState({
      volume: 1,
      shuffle: false,
      repeat: "off",
      snapshot: snapshot({ preset: "custom", gains: stored }),
      resolved: { mode: "manual", gains: [], source: null, detail: "ignored" },
    });
    expect(state.eq.gains).toEqual(stored);
    expect(state.eq.detail).toBeNull();
  });

  it("sends only changed state", () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const state = buildDesktopControlState({
      volume: 1,
      shuffle: false,
      repeat: "off",
      snapshot: snapshot(),
      resolved: getResolvedEqualizer(),
    });
    expect(publishDesktopControlState(state, invoke)).toBe(true);
    expect(publishDesktopControlState(state, invoke)).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("update_desktop_control_state", {
      state,
    });
    expect(publishDesktopControlState(state, undefined)).toBe(false);
  });

  it("notifies subscribers only when the resolved curve changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeResolvedEqualizer(listener);
    const report = {
      mode: "smart" as const,
      gains: FLAT,
      source: "flat" as const,
      detail: null,
    };
    reportResolvedEqualizer(report);
    reportResolvedEqualizer({ ...report, gains: [...FLAT] });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    reportResolvedEqualizer({ ...report, detail: "x" });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
