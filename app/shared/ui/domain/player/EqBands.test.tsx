import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EqBands, eqCurvePath, formatGain, gainToY } from "./EqBands";

const FLAT = Array.from({ length: 10 }, () => 0);

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
      const due = [...callbacks.values()];
      callbacks.clear();
      act(() => due.forEach((callback) => callback(now)));
    },
  };
}

function curveYs(container: HTMLElement): number[] {
  const d = container
    .querySelector("path.stroke-accent-action-hi")!
    .getAttribute("d")!;
  const points = d
    .split(/[MC]/)
    .filter(Boolean)
    .map((segment) => segment.trim().split(/\s+/).map(Number));
  return points.map((numbers) => numbers[numbers.length - 1]!);
}

function handleTops(container: HTMLElement): number[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-eq-handle]"),
    (handle) => Number.parseFloat(handle.style.top),
  );
}

function sliderWithRect(container: HTMLElement, band: number) {
  const slider = container.querySelector<HTMLElement>(`[data-band='${band}']`)!;
  slider.getBoundingClientRect = () =>
    ({ top: 0, height: 100, bottom: 100, left: 0, right: 10 }) as DOMRect;
  return slider;
}

describe("EqBands", () => {
  let frames: ReturnType<typeof fakeAnimationFrames>;

  beforeEach(() => {
    frames = fakeAnimationFrames();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("draws the hairline grid, the accent curve and one numeral per band", () => {
    const { container } = render(
      <EqBands
        gains={[2, 3, 1, -1, 2, 4, 4, 3, 1, -1]}
        onBandChange={vi.fn()}
      />,
    );

    expect(container.querySelector(".stroke-border-quiet")).toBeInTheDocument();
    expect(
      container.querySelector("path.stroke-accent-action-hi"),
    ).toHaveAttribute("d", eqCurvePath([2, 3, 1, -1, 2, 4, 4, 3, 1, -1]));
    expect(container.querySelectorAll("rect")).toHaveLength(10);
    expect(screen.getByText("16K")).toHaveClass("font-mono");
    expect(screen.getAllByText("+4")).toHaveLength(2);
    expect(screen.getAllByText("−1")[0]!.parentElement).toHaveClass(
      "font-display",
    );
    expect(screen.getByText("0 dB")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("var(--idle-");
    expect(container.innerHTML).not.toContain("bg-primary");
  });

  it("has no inline style props in its source", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "EqBands.tsx"),
      "utf8",
    );

    expect(source).not.toMatch(/\bstyle\s*=\s*\{\{/);
  });

  it("keeps handles on the curve in every frame of a morph", () => {
    const { container, rerender } = render(
      <EqBands gains={FLAT} onBandChange={vi.fn()} />,
    );

    expect(frames.request).not.toHaveBeenCalled();
    expect(handleTops(container)).toEqual(curveYs(container));

    rerender(
      <EqBands
        gains={[12, 6, 0, -6, -12, 0, 3, 3, 3, 3]}
        onBandChange={vi.fn()}
      />,
    );
    for (let i = 0; i < 5; i++) {
      frames.step();
      const tops = handleTops(container);
      curveYs(container).forEach((y, band) => {
        expect(tops[band]).toBeCloseTo(y, 1);
      });
    }
    expect(handleTops(container)[0]).toBeGreaterThan(gainToY(12));
  });

  it("does not request animation frames when animate is false", () => {
    const { container, rerender } = render(
      <EqBands gains={FLAT} animate={false} onBandChange={vi.fn()} />,
    );

    rerender(
      <EqBands
        gains={[12, 0, 0, 0, 0, 0, 0, 0, 0, 0]}
        animate={false}
        onBandChange={vi.fn()}
      />,
    );

    expect(frames.request).not.toHaveBeenCalled();
    expect(handleTops(container)[0]).toBe(gainToY(12));
  });

  it("exposes each band as a vertical slider with a value text from props", () => {
    render(
      <EqBands
        gains={[0, 0, 0, 0, 0, 4, 0, 0, 0, 0]}
        onBandChange={vi.fn()}
        bandLabel={(band) => `Band ${band}`}
        bandValueText={(band, gain) => `band ${band} at ${gain}`}
      />,
    );

    const slider = screen.getByRole("slider", { name: "Band 5" });
    expect(slider).toHaveAttribute("aria-orientation", "vertical");
    expect(slider).toHaveAttribute("aria-valuenow", "4");
    expect(slider).toHaveAttribute("aria-valuemin", "-12");
    expect(slider).toHaveAttribute("aria-valuemax", "12");
    expect(slider).toHaveAttribute("aria-valuetext", "band 5 at 4");
  });

  it("steps with the keyboard and commits 150 ms after the last key", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const onBandInput = vi.fn();
    const onBandChange = vi.fn();
    render(
      <EqBands
        gains={FLAT}
        onBandInput={onBandInput}
        onBandChange={onBandChange}
      />,
    );
    const slider = screen.getAllByRole("slider")[2]!;

    fireEvent.keyDown(slider, { key: "ArrowUp" });
    expect(slider).toHaveAttribute("aria-valuenow", "0.5");
    frames.step();
    expect(onBandInput).toHaveBeenLastCalledWith(2, 0.5);

    for (let i = 0; i < 5; i++) {
      act(() => vi.advanceTimersByTime(40));
      fireEvent.keyDown(slider, { key: "ArrowUp" });
    }
    expect(onBandChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(149));
    expect(onBandChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));

    expect(onBandChange).toHaveBeenCalledTimes(1);
    expect(onBandChange).toHaveBeenCalledWith(2, 3);
  });

  it("maps page, home and end keys to their steps and limits", () => {
    const onBandChange = vi.fn();
    render(<EqBands gains={FLAT} onBandChange={onBandChange} />);
    const slider = screen.getAllByRole("slider")[0]!;

    fireEvent.keyDown(slider, { key: "PageUp" });
    expect(slider).toHaveAttribute("aria-valuenow", "3");
    fireEvent.keyDown(slider, { key: "PageDown" });
    fireEvent.keyDown(slider, { key: "PageDown" });
    expect(slider).toHaveAttribute("aria-valuenow", "-3");
    fireEvent.keyDown(slider, { key: "End" });
    expect(slider).toHaveAttribute("aria-valuenow", "12");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(slider).toHaveAttribute("aria-valuenow", "-12");
    fireEvent.blur(slider);

    expect(onBandChange).toHaveBeenCalledTimes(1);
    expect(onBandChange).toHaveBeenCalledWith(0, -12);
  });

  it("commits a 60-move drag once and sends input at most once per frame", () => {
    const onBandInput = vi.fn();
    const onBandChange = vi.fn();
    const { container } = render(
      <EqBands
        gains={FLAT}
        onBandInput={onBandInput}
        onBandChange={onBandChange}
      />,
    );
    const slider = sliderWithRect(container, 5);

    fireEvent.pointerDown(slider, { clientY: 50, pointerId: 1 });
    for (let move = 1; move < 60; move++) {
      fireEvent.pointerMove(slider, {
        clientY: 50 - (move % 30),
        pointerId: 1,
      });
      if (move % 3 === 0) frames.step();
    }
    fireEvent.pointerMove(slider, { clientY: 25, pointerId: 1 });
    const inputsDuringDrag = onBandInput.mock.calls.length;
    fireEvent.pointerUp(slider, { pointerId: 1 });

    expect(inputsDuringDrag).toBeLessThanOrEqual(20);
    expect(onBandChange).toHaveBeenCalledTimes(1);
    expect(onBandChange).toHaveBeenCalledWith(5, 6);
    expect(handleTops(container)[5]).toBe(gainToY(6));
  });

  it("maps a pointer press on a band column to a snapped gain", () => {
    const onBandChange = vi.fn();
    const { container } = render(
      <EqBands gains={FLAT} onBandChange={onBandChange} />,
    );
    const slider = sliderWithRect(container, 5);

    fireEvent.pointerDown(slider, { clientY: 25, pointerId: 1 });
    fireEvent.pointerUp(slider, { pointerId: 1 });

    expect(onBandChange).toHaveBeenCalledWith(5, 6);
  });

  it("ignores pointer and key input when disabled or read-only", () => {
    const onBandChange = vi.fn();
    const { container } = render(
      <EqBands gains={FLAT} onBandChange={onBandChange} disabled />,
    );
    const slider = sliderWithRect(container, 0);

    fireEvent.pointerDown(slider, { clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(slider, { pointerId: 1 });
    fireEvent.keyDown(slider, { key: "ArrowUp" });
    fireEvent.blur(slider);

    expect(onBandChange).not.toHaveBeenCalled();
    expect(slider).toHaveAttribute("aria-disabled", "true");
    expect(container.firstElementChild).toHaveClass("opacity-40");
  });

  it("re-exports the curve helpers", () => {
    expect(formatGain(-1.5)).toBe("−1.5");
    expect(eqCurvePath(FLAT).startsWith("M5 50")).toBe(true);
  });
});
