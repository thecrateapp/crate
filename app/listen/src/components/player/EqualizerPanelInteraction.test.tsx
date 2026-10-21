import { useState } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { EqualizerPopover } from "./EqualizerPopover";
const applyPreset = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-track-eq-curves", () => ({
  useTrackEqCurves: () => ({ curves: [], status: "ready" }),
}));
vi.mock("@/hooks/use-equalizer", () => ({
  useEqualizer: () => ({
    enabled: true,
    preset: "flat",
    gains: Array(10).fill(0),
    smart: false,
    adaptive: false,
    genreAdaptive: false,
    smartStatus: "idle",
    effectiveEq: null,
    toggleEnabled: vi.fn(),
    toggleSmart: vi.fn(),
    toggleAdaptive: vi.fn(),
    toggleGenreAdaptive: vi.fn(),
    applyPreset,
    updateBand: vi.fn(),
    commitBand: vi.fn(),
    resetToFlat: vi.fn(),
    saveForCurrentTrack: vi.fn(),
    clearCurrentTrackPreset: vi.fn(),
  }),
}));
it("selects a preset pill without dismissing the production floating panel", async () => {
  function Harness() {
    const [open, setOpen] = useState(true);
    return <EqualizerPopover open={open} onClose={() => setOpen(false)} />;
  }
  renderWithListenProviders(<Harness />);
  await userEvent.click(screen.getByRole("button", { name: "Rock" }));
  expect(applyPreset).toHaveBeenCalledWith("rock");
  expect(screen.getByRole("dialog", { name: "Equalizer" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(
    screen.queryByRole("dialog", { name: "Equalizer" }),
  ).not.toBeInTheDocument();
});
