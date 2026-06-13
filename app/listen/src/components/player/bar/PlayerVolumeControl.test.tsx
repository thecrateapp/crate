import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlayerVolumeControl } from "@/components/player/bar/PlayerVolumeControl";

describe("PlayerVolumeControl", () => {
  it("uses color and glow hover without drawing a hover frame", () => {
    render(
      <PlayerVolumeControl
        volume={0.5}
        onVolumeChange={vi.fn()}
        onOverlayChange={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Volume" });
    expect(button.className).not.toContain("hover:bg");
    expect(button.className).toContain("hover:text-primary");
    expect(button.className).toContain("hover:drop-shadow");
  });
});
