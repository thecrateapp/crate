import { useReducer } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function renderRefreshablePanel() {
  let refresh = () => {};
  function RuntimePanel() {
    const [, rerender] = useReducer((revision: number) => revision + 1, 0);
    refresh = rerender;
    return <EqualizerPanel />;
  }
  const result = renderWithListenProviders(<RuntimePanel />);
  return { ...result, refresh: () => act(() => refresh()) };
}

describe("EqualizerPanel", () => {
  beforeEach(() => {
    equalizerMock.useEqualizer.mockReset();
    equalizerMock.useEqualizer.mockReturnValue(makeEqualizerState());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete document.documentElement.dataset.crateMotion;
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

    const heading = screen.getByRole("heading", { name: /Equalizer/ });
    const visible = heading.querySelector(".crate-readout");
    const live = screen.getByRole("status");
    expect(visible).toHaveAttribute("aria-hidden", "true");
    expect(visible).toHaveTextContent(/^Custom$/);
    expect(heading).toContainElement(live);
    expect(visible).not.toContainElement(live);
    expect(live).toHaveClass("sr-only");
    expect(live).toHaveTextContent(/^Custom$/);
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
    expect(screen.getByRole("status")).toHaveTextContent(/^Realce de graves$/);
  });

  it("previews a manual edit without announcing it until the band commits", () => {
    document.documentElement.dataset.crateMotion = "reduced";
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frame = callback;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const state = makeEqualizerState();
    equalizerMock.useEqualizer.mockReturnValue(state);
    const { refresh } = renderRefreshablePanel();
    const live = screen.getByRole("status");
    const slider = screen.getAllByRole("slider")[4]!;
    expect(live).toHaveTextContent(/^Flat$/);

    fireEvent.keyDown(slider, { key: "PageUp" });
    act(() => frame?.(16));
    expect(state.updateBand).toHaveBeenCalledWith(4, 3);
    expect(state.commitBand).not.toHaveBeenCalled();
    equalizerMock.useEqualizer.mockReturnValue({
      ...state,
      preset: "custom",
      gains: state.gains.map((gain, index) => (index === 4 ? 3 : gain)),
    });
    refresh();

    expect(
      screen.getByRole("heading", { level: 2 }).querySelector(".crate-readout"),
    ).toHaveTextContent(/^Custom$/);
    expect(screen.getByRole("status")).toBe(live);
    expect(live).toHaveTextContent(/^Flat$/);

    fireEvent.blur(slider);
    expect(state.commitBand).toHaveBeenCalledWith(4, 3);
    expect(live).toHaveTextContent(/^Custom$/);
  });

  it("announces committed preset and externally resolved mode changes", () => {
    const state = makeEqualizerState();
    equalizerMock.useEqualizer.mockReturnValue(state);
    const { refresh } = renderRefreshablePanel();
    const live = screen.getByRole("status");

    fireEvent.click(screen.getByRole("button", { name: "Punk" }));
    expect(state.applyPreset).toHaveBeenCalledWith("punk");
    equalizerMock.useEqualizer.mockReturnValue({ ...state, preset: "punk" });
    refresh();
    expect(live).toHaveTextContent(/^Punk$/);

    equalizerMock.useEqualizer.mockReturnValue({ ...state, smart: true });
    refresh();
    expect(screen.getByRole("status")).toBe(live);
    expect(live).toHaveTextContent(/^Smart curve$/);
  });

  it.each([
    { resolved: { smart: true }, announcement: "Smart curve" },
    { resolved: { preset: "punk" }, announcement: "Punk" },
  ])(
    "announces $announcement when an external change supersedes a manual preview",
    ({ resolved, announcement }) => {
      document.documentElement.dataset.crateMotion = "reduced";
      let frame: FrameRequestCallback | undefined;
      vi.stubGlobal(
        "requestAnimationFrame",
        vi.fn((callback: FrameRequestCallback) => {
          frame = callback;
          return 1;
        }),
      );
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
      const state = makeEqualizerState();
      equalizerMock.useEqualizer.mockReturnValue(state);
      const { refresh } = renderRefreshablePanel();
      const live = screen.getByRole("status");
      const slider = screen.getAllByRole("slider")[4]!;
      fireEvent.keyDown(slider, { key: "PageUp" });
      act(() => frame?.(16));
      const preview = {
        ...state,
        preset: "custom",
        gains: state.gains.map((gain, index) => (index === 4 ? 3 : gain)),
      };
      equalizerMock.useEqualizer.mockReturnValue(preview);
      refresh();
      expect(
        screen
          .getByRole("heading", { level: 2 })
          .querySelector(".crate-readout"),
      ).toHaveTextContent(/^Custom$/);
      expect(live).toHaveTextContent(/^Flat$/);
      expect(state.commitBand).not.toHaveBeenCalled();

      equalizerMock.useEqualizer.mockReturnValue({ ...preview, ...resolved });
      refresh();
      expect(screen.getByRole("status")).toBe(live);
      expect(live).toHaveTextContent(announcement);
      expect(state.commitBand).not.toHaveBeenCalled();

      equalizerMock.useEqualizer.mockReturnValue(preview);
      refresh();
      expect(live).toHaveTextContent(/^Custom$/);

      equalizerMock.useEqualizer.mockReturnValue({
        ...preview,
        adaptive: true,
      });
      refresh();
      expect(live).toHaveTextContent(/^Adaptive active$/);
    },
  );
});
