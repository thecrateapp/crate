import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createShowcase, step } from "./showcase";

const labels = {
  position: (index: number, count: number) => `${index} / ${count}`,
  pause: "Pause",
  play: "Play",
};
let observe: (visible: boolean) => void;
let dispose: () => void = () => {};

function mount(count = 3, autoplay = true) {
  document.body.innerHTML = `
    <section tabindex="-1">
      ${Array.from(
        { length: count },
        (_, index) =>
          `<figure data-slide data-title="Screen ${index}" data-caption="What screen ${index} shows"><img data-srcset="/gallery/listen/${index}.webp 1280w" /></figure>`,
      ).join("")}
      <button data-prev></button>
      <button data-next></button>
      <button data-autoplay></button>
      <p data-counter></p>
      <p data-card-title></p>
      <p data-card-caption></p>
    </section>`;
  const root = document.querySelector("section")!;
  dispose = createShowcase(root, { autoplay, interval: 5000, labels });
  const slides = [...root.querySelectorAll<HTMLElement>("[data-slide]")];
  return {
    root,
    slides,
    active: () =>
      slides.findIndex((slide) => slide.hasAttribute("data-active")),
    counter: root.querySelector("[data-counter]")!,
    toggle: root.querySelector<HTMLButtonElement>("[data-autoplay]")!,
    title: root.querySelector("[data-card-title]")!,
    caption: root.querySelector("[data-card-caption]")!,
    click: (selector: string) =>
      root.querySelector<HTMLButtonElement>(selector)!.click(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
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
});

afterEach(() => {
  dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("step", () => {
  it.each([
    { index: 0, delta: 1, expected: 1 },
    { index: 2, delta: 1, expected: 0 },
    { index: 0, delta: -1, expected: 2 },
  ])("moves $delta from $index to $expected", ({ index, delta, expected }) => {
    expect(step(index, delta, 3)).toBe(expected);
  });
});

describe("createShowcase", () => {
  it("shows the first screen and loads it with the next one", () => {
    const { slides, active, counter } = mount();

    expect(active()).toBe(0);
    expect(counter.textContent).toBe("1 / 3");
    expect(slides[0].querySelector("img")!.getAttribute("srcset")).toBe(
      "/gallery/listen/0.webp 1280w",
    );
    expect(slides[1].querySelector("img")!.getAttribute("srcset")).toBe(
      "/gallery/listen/1.webp 1280w",
    );
    expect(slides[2].querySelector("img")!.getAttribute("srcset")).toBeNull();
    expect(slides[1].getAttribute("aria-hidden")).toBe("true");
  });

  it("advances on its own only while in view", () => {
    const { active } = mount();

    vi.advanceTimersByTime(6000);
    expect(active()).toBe(0);
    observe(true);
    vi.advanceTimersByTime(5000);
    expect(active()).toBe(1);
    observe(false);
    vi.advanceTimersByTime(10000);
    expect(active()).toBe(1);
  });

  it("holds while the pointer is over it", () => {
    const { root, active } = mount();
    observe(true);

    root.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(10000);
    expect(active()).toBe(0);
    root.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(5000);
    expect(active()).toBe(1);
  });

  it("pauses and resumes from its button", () => {
    const { toggle, active } = mount();
    observe(true);

    toggle.click();
    expect(toggle.getAttribute("aria-label")).toBe("Play");
    vi.advanceTimersByTime(10000);
    expect(active()).toBe(0);
    toggle.click();
    vi.advanceTimersByTime(5000);
    expect(active()).toBe(1);
  });

  it("never moves on its own without autoplay", () => {
    const { active } = mount(3, false);
    observe(true);

    vi.advanceTimersByTime(20000);
    expect(active()).toBe(0);
  });

  it("walks with the arrows and the keyboard, wrapping around", () => {
    const { root, active, click } = mount();

    click("[data-prev]");
    expect(active()).toBe(2);
    click("[data-next]");
    expect(active()).toBe(0);
    root.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(active()).toBe(1);
  });

  it("tells the card which screen is showing", () => {
    const { title, caption, counter, click } = mount();

    expect(title.textContent).toBe("Screen 0");
    click("[data-next]");
    expect(title.textContent).toBe("Screen 1");
    expect(caption.textContent).toBe("What screen 1 shows");
    expect(counter.textContent).toBe("2 / 3");
  });
});
