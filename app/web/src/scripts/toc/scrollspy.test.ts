import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScrollspy } from "./scrollspy";

type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;
const observers: { callback: Callback; targets: Element[] }[] = [];
let dispose: () => void = () => {};

function mount() {
  document.body.innerHTML = `
    <nav id="rail"><a href="#01-one">One</a><a href="#02-two">Two</a></nav>
    <section id="01-one"></section>
    <section id="02-two"></section>`;
  const rail = document.getElementById("rail")!;
  dispose = createScrollspy(rail);
  const [spy, reveal] = observers;
  return {
    rail,
    current: () =>
      [...rail.querySelectorAll("[data-current]")].map(
        (link) => link.textContent,
      ),
    enter: (...ids: string[]) =>
      spy.callback(
        ids.map((id) => ({
          target: document.getElementById(id)!,
          isIntersecting: true,
        })),
      ),
    leave: (...ids: string[]) =>
      spy.callback(
        ids.map((id) => ({
          target: document.getElementById(id)!,
          isIntersecting: false,
        })),
      ),
    firstChapter: (visible: boolean, top: number) =>
      reveal.callback([
        {
          isIntersecting: visible,
          boundingClientRect: { top } as DOMRectReadOnly,
        },
      ]),
    spy,
    reveal,
  };
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      entry: { callback: Callback; targets: Element[] };
      constructor(callback: Callback) {
        this.entry = { callback, targets: [] };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.targets.push(target);
      }
      disconnect() {}
    },
  );
});

afterEach(() => {
  dispose();
  vi.unstubAllGlobals();
});

describe("createScrollspy", () => {
  it("watches every chapter the rail links to", () => {
    const { spy } = mount();

    expect(spy.targets.map((target) => target.id)).toEqual([
      "01-one",
      "02-two",
    ]);
  });

  it("waits for the first chapter before showing the rail", () => {
    const { rail, reveal, firstChapter } = mount();

    expect(reveal.targets.map((target) => target.id)).toEqual(["01-one"]);
    firstChapter(false, 900);
    expect(rail.hasAttribute("data-visible")).toBe(false);
    firstChapter(true, 300);
    expect(rail.hasAttribute("data-visible")).toBe(true);
    firstChapter(true, -2000);
    expect(rail.hasAttribute("data-visible")).toBe(true);
  });

  it("marks the chapter crossing the middle of the screen", () => {
    const { current, enter, leave } = mount();

    enter("01-one");
    expect(current()).toEqual(["One"]);
    leave("01-one");
    expect(current()).toEqual(["One"]);
    enter("02-two");
    expect(current()).toEqual(["Two"]);
  });

  it("prefers the earlier chapter when two share the band", () => {
    const { current, enter } = mount();

    enter("02-two", "01-one");
    expect(current()).toEqual(["One"]);
  });

  it("hides the rail and clears the mark when scrolling back above the first chapter", () => {
    const { rail, current, enter, firstChapter } = mount();

    firstChapter(true, 300);
    enter("01-one");
    firstChapter(false, 900);
    expect(current()).toEqual([]);
    expect(rail.hasAttribute("data-visible")).toBe(false);
  });
});
