import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlayerStage } from "./PlayerStage";

describe("PlayerStage", () => {
  it("scrolls tall identity content without drawing a scrollbar", () => {
    const { container } = render(
      <PlayerStage artwork={<div />}>
        <p>Track</p>
      </PlayerStage>,
    );
    expect(container.querySelector('[data-slot="player-stage"]')).toHaveClass(
      "overflow-y-auto",
      "[scrollbar-width:none]",
      "[&::-webkit-scrollbar]:hidden",
    );
  });
});
