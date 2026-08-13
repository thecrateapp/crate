import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlayerSeekBar } from "@/components/player/bar/PlayerSeekBar";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

describe("PlayerSeekBar", () => {
  it("localizes the seek control", () => {
    renderWithListenProviders(
      <PlayerSeekBar currentTime={30} duration={180} onSeek={vi.fn()} />,
      { locale: "es" },
    );

    expect(
      screen.getByRole("slider", { name: "Buscar posición de la canción" }),
    ).toBeVisible();
  });

  it("can be disabled while playback is controlled by a Jam room", () => {
    renderWithListenProviders(
      <PlayerSeekBar
        currentTime={30}
        duration={180}
        onSeek={vi.fn()}
        disabled
      />,
    );

    expect(screen.getByRole("slider")).toBeDisabled();
  });
});
