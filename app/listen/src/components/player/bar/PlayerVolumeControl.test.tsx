import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlayerVolumeControl } from "@/components/player/bar/PlayerVolumeControl";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

describe("PlayerVolumeControl", () => {
  it("uses the canonical ghost action and exposes its popup state", () => {
    renderWithListenProviders(
      <PlayerVolumeControl
        volume={0.5}
        onVolumeChange={vi.fn()}
        onOverlayChange={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Volume" });
    expect(button).toHaveAttribute("data-size", "icon-lg");
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("slider", { name: "Volume" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(button).toHaveFocus();
  });

  it("localizes volume controls", () => {
    renderWithListenProviders(
      <PlayerVolumeControl
        volume={0}
        onVolumeChange={vi.fn()}
        onOverlayChange={vi.fn()}
      />,
      { locale: "es" },
    );

    fireEvent.click(screen.getByRole("button", { name: "Volumen" }));

    expect(screen.getByRole("slider", { name: "Volumen" })).toBeVisible();
  });

  it("uses semantic tokens for the volume track and thumb", () => {
    renderWithListenProviders(
      <PlayerVolumeControl
        volume={0.5}
        onVolumeChange={vi.fn()}
        onOverlayChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Volume" }));

    const slider = screen.getByRole("slider", { name: "Volume" });
    const progressTrack = slider;

    expect(progressTrack?.className).toContain("listen-player-progress");
    expect(progressTrack?.innerHTML).not.toContain("rgba(");
  });
});

it("exposes the vertical volume axis while preserving keyboard steps and endpoints", () => {
  const change = vi.fn();
  renderWithListenProviders(
    <PlayerVolumeControl
      volume={0.5}
      onVolumeChange={change}
      onOverlayChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Volume" }));
  const slider = screen.getByRole("slider", { name: "Volume" });
  expect(slider).toHaveAttribute("aria-orientation", "vertical");
  fireEvent.keyDown(slider, { key: "ArrowUp" });
  expect(change).toHaveBeenLastCalledWith(0.55);
  fireEvent.keyDown(slider, { key: "Home" });
  expect(change).toHaveBeenLastCalledWith(0);
  fireEvent.keyDown(slider, { key: "End" });
  expect(change).toHaveBeenLastCalledWith(1);
});
