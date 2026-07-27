import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const gaplessMock = vi.hoisted(() => {
  type MockContextState = "closed" | "running" | "suspended";

  function createNode() {
    return {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
  }

  function createContext(state: MockContextState) {
    const ctx = {
      state,
      currentTime: 0,
      destination: createNode(),
      close: vi.fn(async () => {
        ctx.state = "closed";
      }),
      resume: vi.fn(async () => {
        ctx.state = "running";
      }),
      createGain: vi.fn(() => ({
        ...createNode(),
        gain: { value: 1 },
      })),
      createOscillator: vi.fn(() => ({
        ...createNode(),
        start: vi.fn(),
        stop: vi.fn(),
      })),
    };
    return ctx;
  }

  const contextQueue: ReturnType<typeof createContext>[] = [];
  const instances: MockGapless5[] = [];

  class MockGapless5 {
    context: ReturnType<typeof createContext>;
    crossfade: number;
    index = 0;
    loop = false;
    masterOut: ReturnType<ReturnType<typeof createContext>["createGain"]>;
    playbackRate = 1;
    pauseCalls = 0;
    playlist = { shuffledIndices: [] as number[], sources: [] as string[] };
    position = 0;
    singleMode = false;
    tracks: string[] = [];
    volume: number;
    playCalls = 0;
    stopCalls = 0;

    constructor(options: { crossfade?: number; volume?: number } = {}) {
      const w = window as Window & {
        gapless5AudioContext?: ReturnType<typeof createContext>;
      };
      if (w.gapless5AudioContext === undefined) {
        w.gapless5AudioContext =
          contextQueue.shift() ?? createContext("running");
      }
      this.context = w.gapless5AudioContext;
      this.masterOut = this.context.createGain();
      this.crossfade = options.crossfade ?? 0;
      this.volume = options.volume ?? 1;
      instances.push(this);
    }

    addTrack(url: string): void {
      this.tracks.push(url);
      this.playlist.sources.push(url);
    }

    currentLength(): number {
      return 0;
    }

    getIndex(): number {
      return this.index;
    }

    getPosition(): number {
      return this.position;
    }

    getTrack(): string {
      return this.tracks[this.index] ?? "";
    }

    getTracks(): string[] {
      return [...this.tracks];
    }

    gotoTrack(indexOrUrl: number | string, forcePlay = false): void {
      this.index =
        typeof indexOrUrl === "number"
          ? indexOrUrl
          : this.tracks.indexOf(indexOrUrl);
      if (forcePlay) this.play();
    }

    isShuffled(): boolean {
      return false;
    }

    play(): void {
      this.playCalls += 1;
    }

    pause(): void {
      this.pauseCalls += 1;
    }

    removeAllTracks(): void {
      this.tracks = [];
      this.playlist.sources = [];
      this.playlist.shuffledIndices = [];
    }

    setCrossfade(ms: number): void {
      this.crossfade = ms;
    }

    setOutputChain(): void {
      // no-op
    }

    setPlaybackRate(rate: number): void {
      this.playbackRate = rate;
    }

    setPosition(ms: number): void {
      this.position = ms;
    }

    setVolume(volume: number): void {
      this.volume = volume;
    }

    stop(): void {
      this.stopCalls += 1;
    }
  }

  return {
    contextQueue,
    createContext,
    instances,
    MockGapless5,
  };
});

vi.mock("@/lib/gapless5/gapless5", () => ({
  Gapless5: gaplessMock.MockGapless5,
}));

vi.mock("@/lib/mobile-audio-mode", () => ({
  stableMobileAudioPipeline: false,
}));

vi.mock("@/lib/dev-logs", () => ({
  recordDevLog: vi.fn(),
  redactUrl: (url: string) => url,
}));

import {
  destroyPlayer,
  initPlayer,
  loadQueue,
  pause,
  play,
  seekTo,
  setCrossfadeDuration,
  setLoop,
  setPlaybackRate,
  setSingleMode,
  setVolume,
} from "@/lib/gapless-player";

async function flushMicrotasks(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
}

describe("gapless player audio recovery", () => {
  beforeEach(() => {
    gaplessMock.contextQueue.length = 0;
    gaplessMock.instances.length = 0;
    document.documentElement.dataset.listenRuntime = "tauri";
  });

  afterEach(() => {
    destroyPlayer();
    delete document.documentElement.dataset.listenRuntime;
    delete (window as Window & { gapless5AudioContext?: unknown })
      .gapless5AudioContext;
    vi.clearAllMocks();
  });

  it("resumes a suspended AudioContext before playback", async () => {
    const context = gaplessMock.createContext("suspended");
    gaplessMock.contextQueue.push(context);

    initPlayer();
    loadQueue(["/tracks/a.flac"], 0);
    await play();

    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(gaplessMock.instances).toHaveLength(1);
    expect(gaplessMock.instances[0]!.playCalls).toBe(1);
  });

  it("ramps Chrome output after resuming a suspended AudioContext", async () => {
    vi.useFakeTimers();
    delete document.documentElement.dataset.listenRuntime;
    const context = gaplessMock.createContext("suspended");
    gaplessMock.contextQueue.push(context);

    initPlayer();
    loadQueue(["/tracks/a.flac"], 0);
    setVolume(0.73);

    await play();

    const player = gaplessMock.instances[0]!;
    expect(player.volume).toBe(0);
    await vi.advanceTimersByTimeAsync(40);
    expect(player.volume).toBeCloseTo(0.73);
    vi.useRealTimers();
  });

  it("rebuilds the player when the AudioContext was closed while idle", async () => {
    const closedContext = gaplessMock.createContext("closed");
    const freshContext = gaplessMock.createContext("running");
    gaplessMock.contextQueue.push(closedContext, freshContext);

    initPlayer();
    loadQueue(["/tracks/a.flac", "/tracks/b.flac"], 1);
    seekTo(42_000);
    setVolume(0.42);
    setCrossfadeDuration(1234);
    setLoop(true);
    setSingleMode(true);
    setPlaybackRate(1.25);

    await play();

    expect(gaplessMock.instances).toHaveLength(2);
    expect(gaplessMock.instances[0]!.stopCalls).toBe(1);

    const recovered = gaplessMock.instances[1]!;
    expect(recovered.context).toBe(freshContext);
    expect(recovered.tracks).toEqual(["/tracks/a.flac", "/tracks/b.flac"]);
    expect(recovered.index).toBe(1);
    expect(recovered.position).toBe(42_000);
    expect(recovered.volume).toBe(0.42);
    expect(recovered.crossfade).toBe(1234);
    expect(recovered.loop).toBe(true);
    expect(recovered.singleMode).toBe(true);
    expect(recovered.playbackRate).toBe(1.25);
    expect(recovered.playCalls).toBe(1);
  });

  it("rebuilds stale Tauri audio output before the next play", async () => {
    const staleContext = gaplessMock.createContext("running");
    const freshContext = gaplessMock.createContext("running");
    gaplessMock.contextQueue.push(staleContext, freshContext);

    initPlayer();
    loadQueue(["/tracks/a.flac", "/tracks/b.flac"], 0);
    seekTo(12_000);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    await play();

    expect(gaplessMock.instances).toHaveLength(2);
    expect(gaplessMock.instances[0]!.stopCalls).toBe(1);

    const recovered = gaplessMock.instances[1]!;
    expect(recovered.context).toBe(freshContext);
    expect(recovered.tracks).toEqual(["/tracks/a.flac", "/tracks/b.flac"]);
    expect(recovered.index).toBe(0);
    expect(recovered.position).toBe(12_000);
    expect(recovered.playCalls).toBe(1);
  });

  it("does not rebuild or restart active Tauri playback when foregrounded", async () => {
    const staleContext = gaplessMock.createContext("running");
    const freshContext = gaplessMock.createContext("running");
    gaplessMock.contextQueue.push(staleContext, freshContext);

    initPlayer();
    loadQueue(["/tracks/a.flac", "/tracks/b.flac"], 1);
    seekTo(32_000);
    await play();
    expect(gaplessMock.instances[0]!.playCalls).toBe(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));

    await flushMicrotasks();
    expect(gaplessMock.instances).toHaveLength(1);
    expect(gaplessMock.instances[0]!.context).toBe(staleContext);
    expect(gaplessMock.instances[0]!.stopCalls).toBe(0);
    expect(gaplessMock.instances[0]!.tracks).toEqual([
      "/tracks/a.flac",
      "/tracks/b.flac",
    ]);
    expect(gaplessMock.instances[0]!.index).toBe(1);
    expect(gaplessMock.instances[0]!.position).toBe(32_000);
    expect(gaplessMock.instances[0]!.playCalls).toBe(1);
  });

  it("upgrades an in-flight Tauri foreground wake before play after pause", async () => {
    const staleContext = gaplessMock.createContext("running");
    const freshContext = gaplessMock.createContext("running");
    gaplessMock.contextQueue.push(staleContext, freshContext);

    initPlayer();
    loadQueue(["/tracks/a.flac", "/tracks/b.flac"], 0);
    seekTo(18_000);
    await play();
    pause();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await play();
    await flushMicrotasks();

    expect(gaplessMock.instances).toHaveLength(2);
    expect(gaplessMock.instances[0]!.stopCalls).toBe(1);

    const recovered = gaplessMock.instances[1]!;
    expect(recovered.context).toBe(freshContext);
    expect(recovered.tracks).toEqual(["/tracks/a.flac", "/tracks/b.flac"]);
    expect(recovered.index).toBe(0);
    expect(recovered.position).toBe(18_000);
    expect(recovered.playCalls).toBe(1);
  });
});
