import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scrambleText } from "./scramble";

describe("scrambleText", () => {
  let frames = new Map<number, FrameRequestCallback>();
  let nextId = 0;

  function runFrames(until: number) {
    for (let now = 0; now <= until; now += 16) {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
    }
  }

  beforeEach(() => {
    frames = new Map();
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++nextId, callback);
      return nextId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("writes the final text immediately when motion is reduced", () => {
    const span = document.createElement("span");
    scrambleText(span, "Copied", { reducedMotion: true });
    expect(span.textContent).toBe("Copied");
  });

  it("settles on the target text", () => {
    const span = document.createElement("span");
    scrambleText(span, "Copied", { durationMs: 100, reducedMotion: false });
    runFrames(200);
    expect(span.textContent).toBe("Copied");
  });

  it("cancels a running scramble when the same element starts another", () => {
    const span = document.createElement("span");
    scrambleText(span, "Copied", { durationMs: 400, reducedMotion: false });
    scrambleText(span, "Copy", { durationMs: 100, reducedMotion: false });
    runFrames(800);
    expect(span.textContent).toBe("Copy");
    expect(frames.size).toBe(0);
  });

  it("stops writing once cancelled", () => {
    const span = document.createElement("span");
    const cancel = scrambleText(span, "Copied", {
      durationMs: 100,
      reducedMotion: false,
    });
    cancel();
    span.textContent = "";
    runFrames(200);
    expect(span.textContent).toBe("");
  });

  it("cancels a running scramble when motion is reduced on the next call", () => {
    const span = document.createElement("span");
    scrambleText(span, "Copied", { durationMs: 400, reducedMotion: false });
    scrambleText(span, "Copy", { reducedMotion: true });
    runFrames(800);
    expect(span.textContent).toBe("Copy");
  });
});
