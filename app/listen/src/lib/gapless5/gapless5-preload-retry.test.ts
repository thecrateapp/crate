import { afterEach, describe, expect, it, vi } from "vitest";
import { Gapless5 } from "@/lib/gapless5/gapless5";

class Media extends EventTarget {
  static elements: Media[] = [];
  src = "";
  currentTime = 0;
  duration = 120;
  volume = 1;
  paused = true;
  seekable = { length: 0 };
  buffered = { length: 0 };

  constructor() {
    super();
    Media.elements.push(this);
  }

  load() {}
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause() {
    this.paused = true;
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
}

let player: Gapless5 | undefined;

function startQueue() {
  vi.useFakeTimers();
  vi.stubGlobal("Audio", Media);
  Media.elements = [];
  const deck = new Gapless5({
    tracks: ["one", "two"],
    loadLimit: 2,
    useWebAudio: false,
    logLevel: 5,
  });
  player = deck;
  deck.play();
  Media.elements
    .find((element) => element.src === "one")!
    .dispatchEvent(new Event("loadeddata"));
  return deck;
}

afterEach(() => {
  player?.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("selecting a prefetched track", () => {
  it("opens the current stream URL on a queue jump and discards a superseded lookup", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Audio", Media);
    Media.elements = [];
    let finishFirst!: (url: string) => void;
    const resolveAudioUrl = vi.fn((url: string) =>
      url === "one"
        ? new Promise<string>((resolve) => {
            finishFirst = resolve;
          })
        : Promise.resolve(url + "?media_ticket=fresh"),
    );
    const fetchAudio = vi.fn<(url: string) => Promise<Response>>(
      () => new Promise<Response>(() => {}),
    );
    vi.stubGlobal("fetch", fetchAudio);
    const deck = new Gapless5({
      tracks: ["one", "two", "three"],
      loadLimit: 1,
      resolveAudioUrl,
    });
    player = deck;
    deck.gotoTrack(2, true);
    await vi.advanceTimersByTimeAsync(1);
    finishFirst("one?media_ticket=obsolete");
    await vi.advanceTimersByTimeAsync(1);

    expect(deck.getTrack()).toBe("three");
    expect(fetchAudio.mock.calls.map(([url]) => url)).toEqual([
      "three?media_ticket=fresh",
    ]);
    expect(
      Media.elements
        .map((el) => el.src)
        .filter((src) => src && !src.startsWith("data:")),
    ).toEqual(["three?media_ticket=fresh"]);
  });

  it.each([true, false])(
    "retries a failed preload once on playback (retry succeeds: %s)",
    async (succeeds) => {
      const deck = startQueue();
      const failures: [string, string][] = [];
      deck.onerror = (path) => failures.push([path, deck.getTrack()]);
      await Promise.resolve();
      const failed = Media.elements.find((element) => element.src === "two")!;
      failed.dispatchEvent(new Event("error"));
      const count = Media.elements.length;
      await vi.advanceTimersByTimeAsync(200);
      expect(Media.elements).toHaveLength(count);
      expect(failures).toEqual([["two", "one"]]);

      deck.next(undefined, true);
      const retry = Media.elements.find((element) => element.src === "two");
      expect(retry).toBeDefined();
      expect(retry).not.toBe(failed);
      failed.dispatchEvent(new Event("loadeddata"));
      expect(deck.isPlaying()).toBe(false);
      retry!.dispatchEvent(new Event(succeeds ? "loadeddata" : "error"));
      await vi.advanceTimersByTimeAsync(200);
      expect(deck.getTrack()).toBe("two");
      expect(deck.isPlaying()).toBe(succeeds);
      expect(Media.elements).toHaveLength(count + 1);
      expect(failures).toEqual(
        succeeds
          ? [["two", "one"]]
          : [
              ["two", "one"],
              ["two", "two"],
            ],
      );
    },
  );

  it("waits for an in-flight preload when skipping to it", async () => {
    const deck = startQueue();
    await Promise.resolve();
    const loading = Media.elements.find((element) => element.src === "two")!;
    deck.next(undefined, true);
    expect(loading.play).not.toHaveBeenCalled();
    loading.dispatchEvent(new Event("loadeddata"));
    expect(loading.play).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(deck.isPlaying()).toBe(true);
  });
});
