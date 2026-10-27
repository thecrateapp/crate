import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canAutoplay, createScreencast } from "./player";

const labels = { play: "Play", pause: "Pause" };
let observe: (visible: boolean) => void;

function mount(chapters = ["one", "two", "three"]) {
  document.body.innerHTML = `
    <section>
      ${chapters
        .map(
          (id, index) =>
            `<figure data-chapter="${id}" ${
              index === 0 ? "data-active" : ""
            }><video></video></figure>`,
        )
        .join("")}
      <button data-toggle></button>
      <ol>${chapters
        .map(
          (_, index) =>
            `<li ${
              index === 0 ? "data-active" : ""
            }><button data-tab></button></li>`,
        )
        .join("")}</ol>
    </section>`;
  const root = document.querySelector("section")!;
  const videos = [...root.querySelectorAll("video")];
  const tabs = [...root.querySelectorAll<HTMLButtonElement>("[data-tab]")];
  const toggle = root.querySelector<HTMLButtonElement>("[data-toggle]")!;
  return { root, videos, tabs, toggle };
}

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        observe = (visible) =>
          callback(
            [{ isIntersecting: visible } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
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
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { value: true, configurable: true });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createScreencast", () => {
  it("plays the active chapter only while the section is in view", () => {
    const { root, videos } = mount();
    createScreencast(root, { autoplay: true, labels });

    observe(true);
    expect(videos[0].paused).toBe(false);
    expect(videos[1].paused).toBe(true);

    observe(false);
    expect(videos[0].paused).toBe(true);
  });

  it("moves to the next chapter when one ends and wraps around", () => {
    const { root, videos, tabs } = mount();
    createScreencast(root, { autoplay: true, labels });
    observe(true);

    videos[0].dispatchEvent(new Event("ended"));
    expect(videos[1].paused).toBe(false);
    expect(tabs[1].getAttribute("aria-pressed")).toBe("true");
    expect(tabs[1].closest("li")!.hasAttribute("data-active")).toBe(true);
    expect(
      root.querySelectorAll("[data-chapter]")[1].hasAttribute("data-active"),
    ).toBe(true);

    videos[1].dispatchEvent(new Event("ended"));
    videos[2].dispatchEvent(new Event("ended"));
    expect(videos[0].paused).toBe(false);
  });

  it("switches chapters from the tabs and rewinds the previous one", () => {
    const { root, videos, tabs } = mount();
    createScreencast(root, { autoplay: true, labels });
    observe(true);
    videos[0].currentTime = 3;

    tabs[2].click();

    expect(videos[0].paused).toBe(true);
    expect(videos[0].currentTime).toBe(0);
    expect(videos[2].paused).toBe(false);
    expect(tabs[0].getAttribute("aria-pressed")).toBe("false");
  });

  it("waits for the play button when autoplay is off", () => {
    const { root, videos, toggle } = mount();
    createScreencast(root, { autoplay: false, labels });
    observe(true);

    expect(videos[0].paused).toBe(true);
    expect(toggle.dataset.state).toBe("play");
    expect(toggle.getAttribute("aria-label")).toBe("Play");

    toggle.click();
    expect(videos[0].paused).toBe(false);
    expect(toggle.dataset.state).toBe("pause");
    expect(toggle.getAttribute("aria-label")).toBe("Pause");
  });

  it("stays paused after the visitor pauses it, even when scrolled back in", () => {
    const { root, videos, toggle } = mount();
    createScreencast(root, { autoplay: true, labels });
    observe(true);

    toggle.click();
    observe(false);
    observe(true);

    expect(videos[0].paused).toBe(true);
  });

  it("stops listening once disposed", () => {
    const { root, videos, tabs } = mount();
    const dispose = createScreencast(root, { autoplay: true, labels });
    observe(true);

    dispose();
    tabs[1].click();

    expect(videos[0].paused).toBe(true);
    expect(videos[1].paused).toBe(true);
  });
});

describe("canAutoplay", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "connection");
  });

  it("refuses with reduced motion", () => {
    expect(canAutoplay(true)).toBe(false);
  });

  it("refuses when the visitor asked to save data", () => {
    Object.defineProperty(navigator, "connection", {
      value: { saveData: true },
      configurable: true,
    });
    expect(canAutoplay(false)).toBe(false);
  });

  it("allows it otherwise", () => {
    expect(canAutoplay(false)).toBe(true);
  });
});
