import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initReveals } from "./reveal";

type Callback = (entries: Partial<IntersectionObserverEntry>[]) => void;

let observed: {
  callback: Callback;
  options?: IntersectionObserverInit;
  targets: Element[];
}[] = [];

beforeEach(() => {
  observed = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      targets: Element[] = [];
      constructor(callback: Callback, options?: IntersectionObserverInit) {
        observed.push({ callback, options, targets: this.targets });
      }
      observe(target: Element) {
        this.targets.push(target);
      }
      unobserve(target: Element) {
        this.targets.splice(this.targets.indexOf(target), 1);
      }
      disconnect() {
        this.targets.length = 0;
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("initReveals", () => {
  it("reveals a section as soon as any of it enters, however tall it is", () => {
    document.body.innerHTML =
      '<section data-reveal style="height:5000px"></section>';
    initReveals();

    expect(observed[0].options?.threshold).toBe(0);
  });

  it("marks intersecting sections and stops watching them", () => {
    document.body.innerHTML =
      "<section data-reveal></section><section data-reveal></section>";
    initReveals();
    const [first, second] = document.querySelectorAll("section");

    observed[0].callback([
      { target: first, isIntersecting: true },
      { target: second, isIntersecting: false },
    ]);

    expect(first.classList.contains("is-in")).toBe(true);
    expect(second.classList.contains("is-in")).toBe(false);
    expect(observed[0].targets).toEqual([second]);
  });
});
