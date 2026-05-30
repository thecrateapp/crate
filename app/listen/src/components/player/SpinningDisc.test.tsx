import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SpinningDisc } from "@/components/player/SpinningDisc";

const bounds = {
  bottom: 200,
  height: 200,
  left: 0,
  right: 200,
  top: 0,
  width: 200,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

function renderDisc(props: Partial<Parameters<typeof SpinningDisc>[0]> = {}) {
  const onSeek = vi.fn();
  const onTogglePlay = vi.fn();
  const onPlaybackRateChange = vi.fn();

  render(
    <SpinningDisc
      currentTime={30}
      duration={120}
      isPlaying={false}
      jogEnabled
      onPlaybackRateChange={onPlaybackRateChange}
      onSeek={onSeek}
      onTogglePlay={onTogglePlay}
      {...props}
    />,
  );

  const surface = screen.getByTestId("spinning-disc-jog-surface");
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(bounds);
  Object.assign(surface, {
    hasPointerCapture: vi.fn(() => true),
    releasePointerCapture: vi.fn(),
    setPointerCapture: vi.fn(),
  });

  return { onPlaybackRateChange, onSeek, surface };
}

describe("SpinningDisc", () => {
  let now = 1000;

  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("seeks while dragging in live jog mode", () => {
    const { onSeek, surface } = renderDisc({ jogSeekMode: "live" });

    fireEvent.pointerDown(surface, {
      button: 0,
      clientX: 200,
      clientY: 100,
      pointerId: 1,
      pointerType: "touch",
    });
    now = 1200;
    fireEvent.pointerMove(surface, {
      clientX: 100,
      clientY: 200,
      pointerId: 1,
      pointerType: "touch",
    });

    expect(onSeek).toHaveBeenCalledTimes(1);
  });

  it("defers seek until release in commit jog mode", () => {
    const { onSeek, surface } = renderDisc({ jogSeekMode: "commit" });

    fireEvent.pointerDown(surface, {
      button: 0,
      clientX: 200,
      clientY: 100,
      pointerId: 1,
      pointerType: "touch",
    });
    now = 1200;
    fireEvent.pointerMove(surface, {
      clientX: 100,
      clientY: 200,
      pointerId: 1,
      pointerType: "touch",
    });

    expect(onSeek).not.toHaveBeenCalled();

    fireEvent.pointerUp(surface, {
      clientX: 100,
      clientY: 200,
      pointerId: 1,
      pointerType: "touch",
    });

    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(expect.any(Number));
  });
});
