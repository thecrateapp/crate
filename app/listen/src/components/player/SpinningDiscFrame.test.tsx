import { render } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { SpinningDiscFrame } from "./SpinningDiscFrame";
import type { PlayerMixTone } from "./player-mix-presentation";

function frame(mixTone?: PlayerMixTone, mixBpm?: number | null) {
  return (
    <SpinningDiscFrame
      rotorRef={createRef()}
      artwork={null}
      control={null}
      mixTone={mixTone}
      mixBpm={mixBpm}
    />
  );
}

function mixRing(container: HTMLElement) {
  return container.querySelector<HTMLElement>(".spinning-disc-mix-ring")!;
}

describe("SpinningDiscFrame mix ring", () => {
  it("stays mounted and unlit without a live mix", () => {
    const { container } = render(frame());
    const ring = mixRing(container);
    expect(ring).not.toHaveAttribute("data-active");
    expect(ring).not.toHaveAttribute("data-beat");
    expect(ring.style.getPropertyValue("--mix-ring-color")).toBe("");
  });

  it("keeps the last tone while the ring fades out after the mix", () => {
    const { container, rerender } = render(frame("beatmatch", 124));
    const ring = mixRing(container);
    expect(ring).toHaveAttribute("data-active");
    expect(ring.style.getPropertyValue("--mix-ring-color")).toBe(
      "var(--state-warning)",
    );

    rerender(frame(undefined, 124));
    expect(ring).not.toHaveAttribute("data-active");
    expect(ring).not.toHaveAttribute("data-beat");
    expect(ring.style.getPropertyValue("--mix-ring-color")).toBe(
      "var(--state-warning)",
    );
  });

  it("pulses on the beat of the track tempo", () => {
    const { container } = render(frame("crossfade", 120));
    const ring = mixRing(container);
    expect(ring).toHaveAttribute("data-beat");
    expect(ring.style.getPropertyValue("--mix-ring-beat")).toBe("0.5s");
  });

  it.each([null, 0, 12, 400])(
    "holds a steady glow when the tempo is unusable (%s)",
    (bpm) => {
      const { container } = render(frame("crossfade", bpm));
      const ring = mixRing(container);
      expect(ring).toHaveAttribute("data-active");
      expect(ring).not.toHaveAttribute("data-beat");
      expect(ring.style.getPropertyValue("--mix-ring-beat")).toBe("");
    },
  );
});
