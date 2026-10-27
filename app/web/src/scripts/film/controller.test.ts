import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeChapter, createFilm, type FilmController } from "./controller";

const labels = {
  play: "Play",
  pause: "Pause",
  replay: "Replay",
  soundOn: "Sound on",
  soundOff: "Sound off",
};
let observers: ((visible: boolean) => void)[] = [];
let film: FilmController | undefined;
let load: ReturnType<typeof vi.spyOn>;

function mount() {
  document.body.innerHTML = `
    <section>
      <video data-film-video>
        <source data-src="/film/listen-16x9.webm" type="video/webm" />
        <source data-src="/film/listen-16x9.mp4" type="video/mp4" />
      </video>
      <button data-film-toggle></button>
      <button data-film-sound></button>
      <button data-film-chapter data-time="0"></button>
      <button data-film-chapter data-time="12"></button>
      <button data-film-chapter data-time="32"></button>
    </section>`;
  const root = document.querySelector("section")!;
  film = createFilm(root, labels);
  const [nearby, visible] = observers;
  return {
    root,
    video: root.querySelector("video")!,
    toggle: root.querySelector<HTMLButtonElement>("[data-film-toggle]")!,
    sound: root.querySelector<HTMLButtonElement>("[data-film-sound]")!,
    chapters: [
      ...root.querySelectorAll<HTMLButtonElement>("[data-film-chapter]"),
    ],
    nearby,
    visible,
  };
}

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push((visible) =>
          callback(
            [{ isIntersecting: visible } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          ),
        );
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { value: false, configurable: true });
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { value: true, configurable: true });
    this.dispatchEvent(new Event("pause"));
  });
  load = vi
    .spyOn(HTMLMediaElement.prototype, "load")
    .mockImplementation(() => {});
});

afterEach(() => {
  film?.dispose();
  film = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("activeChapter", () => {
  it.each([
    { time: -1, expected: -1 },
    { time: 0, expected: 0 },
    { time: 11.99, expected: 1 },
    { time: 20, expected: 1 },
    { time: 60, expected: 2 },
  ])("at $time s is chapter $expected", ({ time, expected }) => {
    expect(activeChapter([{ time: 0 }, { time: 12 }, { time: 32 }], time)).toBe(
      expected,
    );
  });
});

describe("createFilm", () => {
  it("loads the sources only once the section is near", () => {
    const { video, nearby } = mount();

    expect(video.querySelector("source")!.getAttribute("src")).toBeNull();
    nearby(true);

    expect(video.querySelector("source")!.getAttribute("src")).toBe(
      "/film/listen-16x9.webm",
    );
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("plays muted once revealed and pauses out of view", () => {
    const { root, video, visible } = mount();

    visible(true);
    expect(video.paused).not.toBe(false);
    film!.start();

    expect(video.paused).toBe(false);
    expect(video.muted).toBe(true);
    expect(root.dataset.state).toBe("playing");
    visible(false);
    expect(video.paused).toBe(true);
    visible(true);
    expect(video.paused).toBe(false);
  });

  it("turns the sound on and starts playing if it was paused", () => {
    const { video, sound } = mount();

    sound.click();

    expect(video.muted).toBe(false);
    expect(video.paused).toBe(false);
    expect(sound.getAttribute("aria-pressed")).toBe("true");
    expect(sound.getAttribute("aria-label")).toBe("Sound off");
  });

  it("jumps to a chapter and marks it as current", () => {
    const { video, chapters } = mount();

    chapters[2].click();

    expect(video.currentTime).toBe(32);
    expect(video.paused).toBe(false);
    expect(chapters[2].hasAttribute("data-active")).toBe(true);
    expect(chapters[2].getAttribute("aria-current")).toBe("true");
    expect(chapters[0].hasAttribute("data-active")).toBe(false);
  });

  it("toggles between playing and paused", () => {
    const { video, toggle } = mount();

    toggle.click();
    expect(video.paused).toBe(false);
    expect(toggle.getAttribute("aria-label")).toBe("Pause");
    toggle.click();
    expect(video.paused).toBe(true);
    expect(toggle.getAttribute("aria-label")).toBe("Play");
  });
});
