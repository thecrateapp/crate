import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SpectrumPlayButton } from "./SpectrumPlayButton";

describe("SpectrumPlayButton", () => {
  it("renders an accessible cyan glow playback button", () => {
    render(
      <SpectrumPlayButton aria-label="Play" size="lg">
        <span>Icon</span>
      </SpectrumPlayButton>,
    );

    const button = screen.getByRole("button", { name: "Play" });
    expect(button.className).toContain("bg-[conic-gradient");
    expect(button).toHaveClass("h-16");
    expect(button.className).toContain("#22d3ee");
    expect(button.className).toContain("rgba(34,211,238");
  });

  it("forwards click handlers", () => {
    const onClick = vi.fn();
    render(
      <SpectrumPlayButton aria-label="Pause" onClick={onClick}>
        <span>Icon</span>
      </SpectrumPlayButton>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("adds organic pulse layers while active", () => {
    render(
      <SpectrumPlayButton aria-label="Pause" active>
        <span>Icon</span>
      </SpectrumPlayButton>,
    );

    const button = screen.getByRole("button", { name: "Pause" });
    expect(button).toHaveAttribute("data-active", "true");
    expect(button.innerHTML).toContain("animate-crate-play-aura-pulse");
    expect(button.innerHTML).toContain("animate-crate-play-rim-pulse");
    expect(button.innerHTML).toContain("animate-crate-play-core-pulse");
  });
});
