import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EqualizerPanel } from "@/components/player/EqualizerPanel";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const equalizerMock = vi.hoisted(() => ({
  useEqualizer: vi.fn(),
}));

vi.mock("@/hooks/use-equalizer", () => equalizerMock);

function makeEqualizerState(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    preset: "flat",
    gains: Array.from({ length: 10 }, () => 0),
    smart: false,
    adaptive: false,
    genreAdaptive: false,
    smartStatus: "idle",
    effectiveEq: null,
    adaptiveStatus: "idle",
    adaptiveFeatures: null,
    genreAdaptiveStatus: "idle",
    trackGenre: null,
    toggleEnabled: vi.fn(),
    toggleSmart: vi.fn(),
    toggleAdaptive: vi.fn(),
    toggleGenreAdaptive: vi.fn(),
    applyPreset: vi.fn(),
    updateBand: vi.fn(),
    commitBand: vi.fn(),
    resetToFlat: vi.fn(),
    saveForCurrentTrack: vi.fn(),
    clearCurrentTrackPreset: vi.fn(),
    ...overrides,
  };
}

describe("EqualizerPanel", () => {
  beforeEach(() => {
    equalizerMock.useEqualizer.mockReset();
    equalizerMock.useEqualizer.mockReturnValue(makeEqualizerState());
  });

  it("uses semantic tokens throughout the manual panel", () => {
    const { container } = renderWithListenProviders(
      <EqualizerPanel onClose={vi.fn()} />,
    );

    const heading = screen.getByRole("heading", { name: /Equalizer/ });
    expect(heading).toHaveTextContent(/Equalizer.*Flat/);
    expect(heading).toHaveClass("font-mono", "uppercase");
    expect(screen.getByRole("button", { name: "Close equalizer" })).toHaveClass(
      "text-text-muted",
    );
    expect(
      container.querySelector("path.stroke-accent-action-hi"),
    ).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("border-white");
    expect(container.innerHTML).not.toContain("text-white");
    expect(container.innerHTML).not.toContain("cyan-");
    expect(container.innerHTML).not.toContain("red-");
    expect(container.innerHTML).not.toContain("bg-black");
    expect(container.innerHTML).not.toContain("rgba(");
  });

  it("shows the Smart EQ chain with the resolved source highlighted", () => {
    equalizerMock.useEqualizer.mockReturnValue(
      makeEqualizerState({
        smart: true,
        smartStatus: "ready",
        effectiveEq: {
          source: "user_track_preset",
          label: "Saved preset",
          reasoning: "Personal curve",
          genre: null,
          inheritedFrom: null,
        },
      }),
    );

    const { container } = renderWithListenProviders(<EqualizerPanel />);

    const active = container.querySelector("[aria-current='true']");
    expect(active).toHaveAttribute("data-source", "user_track_preset");
    expect(active).toHaveClass("text-accent-action-hi");
    expect(container.querySelectorAll("[data-source]")).toHaveLength(6);
    expect(screen.getByText("Personal curve")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("cyan-");
    expect(container.innerHTML).not.toContain("red-");
  });

  it("marks the active preset chip and applies presets from the chips", async () => {
    const state = makeEqualizerState({ preset: "punk" });
    equalizerMock.useEqualizer.mockReturnValue(state);

    renderWithListenProviders(<EqualizerPanel />);

    const punk = screen.getByRole("button", { name: "Punk" });
    expect(punk).toHaveAttribute("aria-pressed", "true");
    expect(punk).toHaveClass("bg-accent-action-hi", "font-mono");
    expect(
      screen.getByRole("heading", { name: /Equalizer/ }),
    ).toHaveTextContent(/Equalizer.*Punk/);

    screen.getByRole("button", { name: "Shoegaze" }).click();
    expect(state.applyPreset).toHaveBeenCalledWith("shoegaze");
  });

  it("shows the active mode once, in the header", () => {
    equalizerMock.useEqualizer.mockReturnValue(
      makeEqualizerState({ preset: "custom" }),
    );

    renderWithListenProviders(<EqualizerPanel />);

    expect(screen.getAllByText("Custom")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: /Equalizer/ }),
    ).toHaveTextContent(/Equalizer.*Custom/);
  });

  it("translates the preset chips and the header preset name", () => {
    equalizerMock.useEqualizer.mockReturnValue(
      makeEqualizerState({ preset: "bass_boost" }),
    );

    renderWithListenProviders(<EqualizerPanel />, { locale: "es" });

    expect(
      screen.getByRole("button", { name: "Realce de graves" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Clásica" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      /Realce de graves/,
    );
  });
});
