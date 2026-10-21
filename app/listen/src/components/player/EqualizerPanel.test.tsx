import { useReducer } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EqualizerPanelView } from "./EqualizerPanelSections";
import type { EqualizerPanelState } from "./equalizer-panel-state";
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
    expect(active).toHaveClass("font-mono", "text-accent-action-hi");
    expect(container.querySelectorAll("[data-source]")).toHaveLength(1);
    expect(active).not.toHaveAttribute("title");
    expect(container.innerHTML).not.toContain("cyan-");
    expect(container.innerHTML).not.toContain("red-");
  });

  it("keeps confirmed track curves separate from the available preset pills", () => {
    equalizerMock.useEqualizer.mockReturnValue(
      makeEqualizerState({
        smart: true,
        smartStatus: "ready",
        effectiveEq: {
          source: "instance_album_preset",
          label: "Album curve",
          reasoning: "",
          genre: null,
        },
      }),
    );
    const { container } = renderWithListenProviders(<EqualizerPanel />);
    expect(screen.getByRole("button", { name: "Shoegaze" })).toBeEnabled();
    expect(container.querySelectorAll("[data-source]")).toHaveLength(1);
    expect(
      container.querySelector('[data-source="instance_album_preset"]'),
    ).toHaveAttribute("aria-current", "true");
  });

  it.each(["smart", "genreAdaptive", "adaptive", "manual"])(
    "uses one accent MonoLabel information band for %s",
    (mode) => {
      equalizerMock.useEqualizer.mockReturnValue(
        makeEqualizerState({
          [mode]: true,
          genreAdaptiveStatus: "unavailable",
          adaptiveStatus: "unavailable",
        }),
      );
      const { container } = renderWithListenProviders(<EqualizerPanel />);
      const band = container.querySelector('[data-slot="eq-curve-readout"]')!;
      expect(band).toHaveClass(
        "crate-mono-label",
        "font-mono",
        "font-normal",
        "uppercase",
        "bg-accent-action/10",
        "border-accent-action/30",
      );
      expect(band.querySelector('[data-slot="badge"]')).toBeNull();
      expect(
        container.querySelectorAll('[data-slot="eq-curve-readout"]'),
      ).toHaveLength(1);
    },
  );

  it("puts Genre information between the bands and presets without a second Smart or footer readout", () => {
    const state = makeEqualizerState({
      genreAdaptive: true,
      genreAdaptiveStatus: "ready",
      trackGenre: {
        primary: { slug: "grindcore", name: "Grindcore", canonical: true },
        topLevel: null,
        source: "album",
        preset: {
          gains: Array(10).fill(2),
          source: "direct",
          inheritedFrom: null,
        },
      },
    });
    equalizerMock.useEqualizer.mockReturnValue(state);
    const { container } = renderWithListenProviders(<EqualizerPanel />);
    const info = container.querySelector('[data-slot="eq-curve-readout"]')!;
    expect(info).toContainElement(screen.getByText("Grindcore"));
    expect(
      info.compareDocumentPosition(
        screen.getByRole("group", { name: "Presets" }),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      container
        .querySelector('[data-slot="eq-bands-viewport"]')!
        .compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText(/Smart EQ is waiting/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Grindcore")).toHaveLength(1);
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

  it("keeps a translated power chip and current mode in the header", () => {
    equalizerMock.useEqualizer.mockReturnValue(
      makeEqualizerState({ preset: "bass_boost" }),
    );
    renderWithListenProviders(<EqualizerPanel />, { locale: "es" });
    expect(screen.getByRole("button", { name: "Activo" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      /Realce de graves/,
    );
  });

  it("keeps mode controls separate from the title and power row", () => {
    const state = makeEqualizerState({ smart: true });
    equalizerMock.useEqualizer.mockReturnValue(state);
    renderWithListenProviders(<EqualizerPanel onClose={vi.fn()} />);
    const header = screen.getByRole("heading", {
      name: /Equalizer/,
    }).parentElement!;
    const genre = screen.getByRole("button", { name: "Genre" });
    const adaptive = screen.getByRole("button", { name: "Adaptive" });
    expect(header).not.toContainElement(genre);
    expect(header).not.toContainElement(adaptive);
    expect(header).toContainElement(screen.getByRole("button", { name: "On" }));
    expect(header).toContainElement(
      screen.getByRole("button", { name: "Close equalizer" }),
    );
    fireEvent.click(genre);
    expect(state.toggleGenreAdaptive).toHaveBeenCalledWith(true);
    fireEvent.click(adaptive);
    expect(state.toggleAdaptive).toHaveBeenCalledWith(true);
    expect(screen.queryByText("Manual helpers")).not.toBeInTheDocument();
  });

  it("shows preset pills immediately and applies Rock", () => {
    const state = makeEqualizerState();
    equalizerMock.useEqualizer.mockReturnValue(state);
    renderWithListenProviders(<EqualizerPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Rock" }));
    expect(state.applyPreset).toHaveBeenCalledWith("rock");
  });

  it.each(["manual", "smart", "genreAdaptive"] as const)(
    "names the applied Jazz curve consistently in %s mode",
    (mode) => {
      equalizerMock.useEqualizer.mockReturnValue(
        makeEqualizerState({
          preset: "jazz",
          smart: mode === "smart",
          genreAdaptive: mode === "genreAdaptive",
          smartStatus: "ready",
          genreAdaptiveStatus: "ready",
          effectiveEq: {
            source: "genre_taxonomy_preset",
            label: "Genre: Jazz",
            reasoning: "",
            genre: { slug: "jazz", name: "Jazz" },
            inheritedFrom: null,
          },
          trackGenre: {
            primary: { slug: "jazz", name: "Jazz", canonical: true },
            topLevel: null,
            source: "album",
            preset: {
              gains: Array(10).fill(2),
              source: "direct",
              inheritedFrom: null,
            },
          },
        }),
      );
      const { container } = renderWithListenProviders(<EqualizerPanel />);
      const band = container.querySelector('[data-slot="eq-curve-readout"]')!;
      expect(band).toHaveTextContent(
        mode === "manual" ? /^Preset: Jazz$/ : /^Genre taxonomy: Jazz$/,
      );
      expect(band).toHaveClass("uppercase");
    },
  );

  it("can select the remembered preset while Smart is active", () => {
    const state = makeEqualizerState({ preset: "rock", smart: true });
    equalizerMock.useEqualizer.mockReturnValue(state);
    renderWithListenProviders(<EqualizerPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Rock" }));
    expect(state.applyPreset).toHaveBeenCalledWith("rock");
  });

  it.each([
    { mode: "adaptive", status: "loading" },
    { mode: "adaptive", status: "unavailable" },
    { mode: "genre", status: "loading" },
    { mode: "genre", status: "unavailable" },
  ] as const)(
    "does not mark a $mode helper active while $status",
    ({ mode, status }) => {
      const state = makeEqualizerState({
        adaptive: mode === "adaptive",
        adaptiveStatus: status,
        genreAdaptive: mode === "genre",
        genreAdaptiveStatus: status,
      }) as unknown as EqualizerPanelState;
      const { container } = renderWithListenProviders(
        <EqualizerPanelView
          eq={state}
          curves={[
            {
              source:
                mode === "adaptive"
                  ? "audio_analysis_preset"
                  : "genre_taxonomy_preset",
              gains: Array(10).fill(1),
              label: "Curve",
              reasoning: "",
              genre: null,
            },
          ]}
          curvesStatus="ready"
          saving={false}
          onClear={() => {}}
          onSave={() => {}}
          t={((key: string) => key) as never}
        />,
      );
      expect(container.querySelector('[aria-current="true"]')).toBeNull();
    },
  );

  it("marks a resolved genre curve current only when usable gains are present", () => {
    const state = makeEqualizerState({
      genreAdaptive: true,
      genreAdaptiveStatus: "ready",
      trackGenre: {
        primary: { slug: "rock", name: "Rock", canonical: true },
        topLevel: null,
        source: "album",
        preset: {
          gains: Array(10).fill(1),
          source: "direct",
          inheritedFrom: null,
        },
      },
    }) as unknown as EqualizerPanelState;
    const { container } = renderWithListenProviders(
      <EqualizerPanelView
        eq={state}
        curves={[
          {
            source: "genre_taxonomy_preset",
            gains: Array(10).fill(1),
            label: "Rock",
            reasoning: "",
            genre: null,
          },
        ]}
        curvesStatus="ready"
        saving={false}
        onClear={() => {}}
        onSave={() => {}}
        t={((key: string) => key) as never}
      />,
    );
    expect(container.querySelector('[aria-current="true"]')).toHaveAttribute(
      "data-source",
      "genre_taxonomy_preset",
    );
  });

  it("powers off without destroying the saved curve and can power on again", () => {
    const state = makeEqualizerState({
      enabled: false,
      gains: Array(10).fill(4),
    });
    equalizerMock.useEqualizer.mockReturnValue(state);
    const { refresh } = renderRefreshablePanel();
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/Off/);
    screen
      .getAllByRole("slider")
      .forEach((slider) =>
        expect(slider).toHaveAttribute("aria-valuenow", "0"),
      );
    const power = screen.getByRole("button", { name: "Off" });
    expect(power).not.toBeDisabled();
    fireEvent.click(power);
    expect(state.toggleEnabled).toHaveBeenCalledWith(true);
    expect(state.gains).toEqual(Array(10).fill(4));
    equalizerMock.useEqualizer.mockReturnValue({ ...state, enabled: true });
    refresh();
    screen
      .getAllByRole("slider")
      .forEach((slider) =>
        expect(slider).toHaveAttribute("aria-valuenow", "4"),
      );
  });

  it.each(["smart", "adaptive", "genreAdaptive"] as const)(
    "allows editing the displayed %s curve without an extra mode switch",
    (mode) => {
      const state = makeEqualizerState({
        [mode]: true,
        gains: Array(10).fill(3),
      });
      equalizerMock.useEqualizer.mockReturnValue(state);
      renderWithListenProviders(<EqualizerPanel />);
      const slider = screen.getAllByRole("slider")[0]!;
      expect(slider).not.toHaveAttribute("aria-disabled", "true");
      fireEvent.keyDown(slider, { key: "ArrowUp" });
      fireEvent.blur(slider);
      expect(state.commitBand).toHaveBeenCalledWith(0, 3.5);
    },
  );

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
