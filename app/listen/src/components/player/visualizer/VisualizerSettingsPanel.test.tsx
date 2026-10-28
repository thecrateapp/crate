import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VisualizerSettingsPanel } from "./VisualizerSettingsPanel";
import type { VisualizerConfigState } from "./useVisualizerConfig";
import { DEFAULT_PROFILE } from "./visualizer-track-profile-model";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

function makeConfig(
  overrides: Partial<VisualizerConfigState> = {},
): VisualizerConfigState {
  const settings = {
    separation: 0.15,
    glow: 6,
    scale: 1.4,
    persistence: 0.8,
    octaves: 2,
  };
  return {
    surfaceMode: "visualizer",
    vizEnabled: true,
    useAlbumPalette: true,
    trackAdaptiveViz: false,
    vizConfig: settings,
    effectiveVizConfig: settings,
    trackVizProfile: DEFAULT_PROFILE,
    setSurfaceMode: vi.fn(),
    toggleAlbumPalette: vi.fn(),
    toggleTrackAdaptive: vi.fn(),
    updateConfig: vi.fn(),
    resetConfig: vi.fn(),
    ...overrides,
  };
}

describe("VisualizerSettingsPanel", () => {
  it("uses canonical labelled controls and preserves native ranges, exact precision and callbacks", () => {
    const config = makeConfig();
    const { container } = renderWithListenProviders(
      <VisualizerSettingsPanel config={config} />,
    );
    expect(
      screen.getByRole("heading", { name: "Visualizer settings" }),
    ).toHaveClass("text-accent-action-hi");
    const ranges = screen.getAllByRole("slider");
    expect(ranges).toHaveLength(5);
    for (const range of ranges) {
      expect(range).toHaveAttribute("data-slot", "slider");
      expect(range.closest('[data-slot="form-field"]')).toHaveAttribute(
        "data-layout",
        "stacked",
      );
    }
    const separation = screen.getByRole("slider", { name: "Separation" });
    expect(separation).toHaveAttribute("min", "0");
    expect(separation).toHaveAttribute("max", "0.5");
    expect(separation).toHaveAttribute("step", "0.01");
    expect(separation.closest('[data-slot="form-field"]')).toHaveTextContent(
      "0.15",
    );
    fireEvent.change(separation, { target: { value: "0.24" } });
    expect(config.updateConfig).toHaveBeenCalledWith({
      ...config.vizConfig,
      separation: 0.24,
    });
    fireEvent.click(screen.getByRole("switch", { name: "Album palette" }));
    expect(config.toggleAlbumPalette).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("switch", { name: "Track adaptive" }));
    expect(config.toggleTrackAdaptive).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(config.resetConfig).toHaveBeenCalledOnce();
    expect(
      container.querySelectorAll(
        '[data-slot="form-field"][data-layout="inline"]',
      ),
    ).toHaveLength(2);
  });

  it.each(["cd", "cover"] as const)(
    "keeps saved toggles usable with disabled ranges in %s mode",
    (surfaceMode) => {
      renderWithListenProviders(
        <VisualizerSettingsPanel
          config={makeConfig({ vizEnabled: false, surfaceMode })}
        />,
      );
      for (const slider of screen.getAllByRole("slider"))
        expect(slider).toBeDisabled();
      for (const toggle of screen.getAllByRole("switch"))
        expect(toggle).not.toBeDisabled();
      expect(
        screen.getByText(
          surfaceMode === "cd" ? "CD mode active" : "Cover mode active",
        ),
      ).toBeVisible();
    },
  );

  it("separates waiting analysis, actual zero and adapted readings without announcing each slider value", () => {
    const config = makeConfig({ trackAdaptiveViz: true });
    const { rerender, container } = renderWithListenProviders(
      <VisualizerSettingsPanel config={config} />,
    );
    expect(
      screen.getByText("Adaptive on, waiting for track analysis"),
    ).toBeVisible();
    rerender(
      <VisualizerSettingsPanel
        config={{
          ...config,
          trackVizProfile: {
            ...DEFAULT_PROFILE,
            hasAnalysis: true,
            summary: "Dark · 124 BPM",
          },
          effectiveVizConfig: {
            ...config.vizConfig,
            glow: 0,
            separation: 0.24,
          },
        }}
      />,
    );
    expect(
      screen.getByText("Using track analysis · Dark · 124 BPM"),
    ).toBeVisible();
    expect(screen.getByRole("slider", { name: "Separation" })).toHaveAttribute(
      "aria-valuetext",
      "Saved 0.15; adapted 0.24",
    );
    expect(screen.getByRole("slider", { name: "Glow" })).toHaveAttribute(
      "aria-valuetext",
      "Saved 6.0; adapted 0.0",
    );
    const field = screen
      .getByRole("slider", { name: "Glow" })
      .closest('[data-slot="form-field"]');
    expect(field).toHaveTextContent("6.0");
    expect(field).toHaveTextContent("0.0");
    expect(container.querySelector('[aria-live="assertive"]')).toBeNull();
  });

  it("translates captions, control labels, reset and status", () => {
    renderWithListenProviders(
      <VisualizerSettingsPanel
        config={makeConfig({ vizEnabled: false, surfaceMode: "cd" })}
      />,
      { locale: "es" },
    );
    expect(
      screen.getByRole("heading", { name: "Ajustes del visualizador" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Restablecer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: "Paleta del álbum" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Separación" })).toBeDisabled();
    expect(screen.getByText("Modo CD activo")).toBeVisible();
  });
});
