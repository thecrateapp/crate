import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlayerVolumeControl } from "@/components/player/bar/PlayerVolumeControl";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

describe("PlayerVolumeControl", () => {
  it("uses color and glow hover without drawing a hover frame", () => {
    renderWithListenProviders(
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

  it("localizes volume controls", () => {
    renderWithListenProviders(
      <PlayerVolumeControl
        volume={0}
        onVolumeChange={vi.fn()}
        onOverlayChange={vi.fn()}
      />,
      { locale: "es" },
    );

    fireEvent.click(screen.getByRole("button", { name: "Activar sonido" }));

    expect(screen.getByRole("slider", { name: "Volumen" })).toBeVisible();
  });
});
