// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initHoverScramble, scrambleText } from "./scramble";

let frames = new Map<number, FrameRequestCallback>();
let nextId = 0;
let fine = true;

function runFrames(until: number) {
  for (let now = 0; now <= until; now += 16) {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(now));
  }
}

function over(target: Element, relatedTarget: Element | null = document.body) {
  target.dispatchEvent(
    new MouseEvent("mouseover", { bubbles: true, relatedTarget }),
  );
}

beforeEach(() => {
  frames = new Map();
  fine = true;
  vi.spyOn(performance, "now").mockReturnValue(0);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("matchMedia", () => ({ matches: fine }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("scrambleText", () => {
  it("writes the final text immediately when motion is reduced", () => {
    const span = document.createElement("span");
    scrambleText(span, "Copied", { reducedMotion: true });
    expect(span.textContent).toBe("Copied");
  });

  it("scrambles and then settles on the target text", () => {
    const span = document.createElement("span");
    scrambleText(span, "Copied", { durationMs: 100 });
    runFrames(16);
    expect(span.textContent).toHaveLength(6);
    runFrames(200);
    expect(span.textContent).toBe("Copied");
  });

  it("cancels a running scramble when the same element starts another", () => {
    const span = document.createElement("span");
    scrambleText(span, "Copied", { durationMs: 400 });
    scrambleText(span, "Copy", { durationMs: 100 });
    runFrames(800);
    expect(span.textContent).toBe("Copy");
    expect(frames.size).toBe(0);
  });
});

describe("initHoverScramble", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <nav><a href="/listen" data-hover-scramble="true">Listen</a></nav>
      <ol><li><a href="#play"><b>01</b> <span data-hover-scramble>Play</span></a></li></ol>
      <a href="/plain">Plain</a>`;
  });

  it("scrambles a link label on hover and settles back on it", () => {
    const stop = initHoverScramble({ reducedMotion: false });
    const link = document.querySelector<HTMLElement>("nav a")!;

    over(link);
    expect(frames.size).toBe(1);
    runFrames(400);

    expect(link.textContent).toBe("Listen");
    stop();
  });

  it("scrambles only the marked title, never the chapter number", () => {
    const stop = initHoverScramble({ reducedMotion: false });
    const link = document.querySelector("ol a")!;

    over(link);
    runFrames(16);

    expect(link.querySelector("b")!.textContent).toBe("01");
    runFrames(400);
    expect(link.querySelector("span")!.textContent).toBe("Play");
    stop();
  });

  it("starts once per entry and keeps the original label when hovered mid-scramble", () => {
    const stop = initHoverScramble({ reducedMotion: false });
    const link = document.querySelector("ol a")!;
    const title = link.querySelector("span")!;

    over(link);
    over(title, link.querySelector("b"));
    expect(frames.size).toBe(1);

    runFrames(32);
    over(link);
    runFrames(400);
    expect(title.textContent).toBe("Play");
    stop();
  });

  it("leaves unmarked links alone", () => {
    const stop = initHoverScramble({ reducedMotion: false });
    over(document.querySelector("a[href='/plain']")!);
    expect(frames.size).toBe(0);
    stop();
  });

  it("stays off for reduced motion and touch screens", () => {
    initHoverScramble({ reducedMotion: true });
    fine = false;
    initHoverScramble({ reducedMotion: false });

    over(document.querySelector("nav a")!);
    expect(frames.size).toBe(0);
  });

  it("stops listening when cleaned up", () => {
    initHoverScramble({ reducedMotion: false })();
    over(document.querySelector("nav a")!);
    expect(frames.size).toBe(0);
  });
});
