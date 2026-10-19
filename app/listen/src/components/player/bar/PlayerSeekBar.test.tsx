import { fireEvent, screen } from "@testing-library/react";
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

  it("uses semantic tokens for the default progress track", () => {
    renderWithListenProviders(
      <PlayerSeekBar currentTime={30} duration={180} onSeek={vi.fn()} />,
    );

    const slider = screen.getByRole("slider");

    expect(slider.className).toContain("listen-player-seek-input");
    expect(slider.getAttribute("style")).toContain("--seek-progress");
    expect(slider.getAttribute("style")).not.toContain("rgba(");
  });

  it("uses semantic tokens for the glow presentation", () => {
    renderWithListenProviders(
      <PlayerSeekBar
        currentTime={30}
        duration={180}
        onSeek={vi.fn()}
        variant="glow"
        showTimes
      />,
    );

    const slider = screen.getByRole("slider");
    const progressTrack = slider.parentElement;

    expect(progressTrack?.className).toContain("listen-player-progress");
    expect(progressTrack?.innerHTML).not.toContain("rgba(");
  });
});

it.each([
  [false, "h-0.5"],
  [true, "h-px"],
] as const)(
  "retains the glow trail with V3 thickness (thin=%s)",
  (thin, heightClass) => {
    const onSeek = vi.fn();
    const { container } = renderWithListenProviders(
      <PlayerSeekBar
        currentTime={30}
        duration={120}
        onSeek={onSeek}
        variant="glow"
        thin={thin}
      />,
    );
    expect(
      container.querySelector(".listen-player-progress-track"),
    ).toHaveClass(heightClass);
    expect(
      container.querySelector(".listen-player-progress-glow"),
    ).toBeInTheDocument();
    const position = container.querySelector(
      ".listen-player-progress-position",
    );
    expect(position).toHaveStyle({ width: "25%" });
    expect(
      position?.querySelector(".listen-player-progress-trail"),
    ).toBeInTheDocument();
    expect(
      position?.querySelector(".listen-player-progress-thumb"),
    ).toBeInTheDocument();
    expect(
      position?.querySelector(".listen-player-progress-thumb-active"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "60" } });
    expect(onSeek).toHaveBeenCalledWith(60);
  },
);

it("keeps elapsed/remaining time and keyboard seeking in the canonical control", () => {
  const seek = vi.fn();
  renderWithListenProviders(
    <PlayerSeekBar
      currentTime={60}
      duration={240}
      onSeek={seek}
      showTimes
      remaining
      variant="glow"
    />,
  );
  expect(screen.getByText("1:00")).toBeInTheDocument();
  expect(screen.getByText("-3:00")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowLeft" });
  expect(seek).toHaveBeenLastCalledWith(55);
  fireEvent.keyDown(screen.getByRole("slider"), { key: "End" });
  expect(seek).toHaveBeenLastCalledWith(240);
});
