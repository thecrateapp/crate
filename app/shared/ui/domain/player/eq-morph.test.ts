import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EQ_SPRING,
  FIRST_FRAME_DT,
  MAX_FRAME_DT,
  createSpringSet,
  frameDt,
  springsSettled,
  stepSpring,
  useEqMorph,
} from "./eq-morph";

function fakeAnimationFrames() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  let now = 0;
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, callback);
    return id;
  });
  vi.stubGlobal("requestAnimationFrame", request);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  return {
    request,
    pending: () => callbacks.size,
    step(ms = 1000 / 60) {
      now += ms;
      const due = [...callbacks.entries()];
      callbacks.clear();
      due.forEach(([, callback]) => callback(now));
    },
  };
}

describe("spring helpers", () => {
  it("settles a 12 dB step at 120/14 within 65 frames at 60 Hz with about 5% overshoot", () => {
    const [spring] = createSpringSet([0]);
    spring!.target = 12;
    let peak = 0;
    let frames = 0;

    while (!springsSettled([spring!]) && frames < 200) {
      stepSpring(spring!, 1 / 60, EQ_SPRING);
      peak = Math.max(peak, spring!.value);
      frames += 1;
    }

    expect(frames).toBeLessThanOrEqual(65);
    expect((peak - 12) / 12).toBeLessThan(0.055);
  });

  it("clamps dt to 50 ms and uses 1/60 s on the first frame", () => {
    expect(frameDt(1000, null)).toBe(FIRST_FRAME_DT);
    expect(frameDt(1500, 1000)).toBe(MAX_FRAME_DT);
    expect(frameDt(1010, 1000)).toBeCloseTo(0.01);

    const clamped = createSpringSet([0])[0]!;
    const capped = createSpringSet([0])[0]!;
    clamped.target = 12;
    capped.target = 12;
    stepSpring(clamped, 2, EQ_SPRING);
    stepSpring(capped, MAX_FRAME_DT, EQ_SPRING);

    expect(clamped).toEqual(capped);
  });

  it("treats a spring as settled only when value and velocity are near rest", () => {
    expect(springsSettled([{ value: 1.005, velocity: 0, target: 1 }])).toBe(
      true,
    );
    expect(springsSettled([{ value: 1, velocity: 0.5, target: 1 }])).toBe(
      false,
    );
    expect(springsSettled([{ value: 0, velocity: 0, target: 1 }])).toBe(false);
  });
});

// TEST_GAP: jsdom has no frame clock, so real rAF cadence, background-tab throttling and
// on-device smoothness are checked in the VISUAL captures and the Checkpoint 0 review.
describe("useEqMorph", () => {
  let frames: ReturnType<typeof fakeAnimationFrames>;

  beforeEach(() => {
    frames = fakeAnimationFrames();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup(initial: number[], animate = true, blocked = false) {
    const render = vi.fn();
    const draggedBandRef = { current: null as number | null };
    const hook = renderHook(
      ({ targets, animate: allowed }) =>
        useEqMorph({
          targets,
          animate: allowed,
          draggedBandRef,
          render,
          isBlocked: () => blocked,
        }),
      { initialProps: { targets: initial, animate } },
    );
    return { ...hook, render, draggedBandRef };
  }

  it("paints the target on the first render without requesting a frame", () => {
    const { render } = setup([3, -2]);

    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenLastCalledWith([3, -2]);
    expect(frames.request).not.toHaveBeenCalled();
  });

  it("springs to new targets and stops the loop once settled", () => {
    const { render, rerender } = setup([0, 0]);

    rerender({ targets: [12, 0], animate: true });
    expect(frames.pending()).toBe(1);
    frames.step();
    const firstFrame = render.mock.lastCall![0] as number[];
    expect(firstFrame[0]).toBeGreaterThan(0);
    expect(firstFrame[0]).toBeLessThan(12);

    for (let i = 0; i < 120 && frames.pending() > 0; i++) frames.step();

    expect(frames.pending()).toBe(0);
    expect(render).toHaveBeenLastCalledWith([12, 0]);
  });

  it("writes the target at once when motion is blocked", () => {
    const { render, rerender } = setup([0, 0], true, true);

    rerender({ targets: [6, 6], animate: true });

    expect(frames.request).not.toHaveBeenCalled();
    expect(render).toHaveBeenLastCalledWith([6, 6]);
  });

  it("writes the target at once when animate is false", () => {
    const { render, rerender } = setup([0, 0], false);

    rerender({ targets: [6, 6], animate: false });

    expect(frames.request).not.toHaveBeenCalled();
    expect(render).toHaveBeenLastCalledWith([6, 6]);
  });

  it("never springs the dragged band", () => {
    const { render, rerender, draggedBandRef } = setup([0, 0]);

    draggedBandRef.current = 1;
    rerender({ targets: [12, 9], animate: true });
    frames.step();

    const values = render.mock.lastCall![0] as number[];
    expect(values[1]).toBe(9);
    expect(values[0]).toBeLessThan(12);
  });

  it("cancels the loop on unmount", () => {
    const { rerender, unmount } = setup([0]);

    rerender({ targets: [12], animate: true });
    expect(frames.pending()).toBe(1);
    unmount();

    expect(frames.pending()).toBe(0);
  });
});
