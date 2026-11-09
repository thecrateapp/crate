import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SmartMixChip } from "@/components/playlists/SmartMixChip";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const breakpoint = vi.hoisted(() => ({ desktop: true }));

vi.mock("@crate/ui/lib/use-breakpoint", () => ({
  useIsDesktop: () => breakpoint.desktop,
}));

describe("SmartMixChip", () => {
  beforeEach(() => {
    breakpoint.desktop = true;
  });

  it("counts the tracks with stems while the server separates", () => {
    renderWithListenProviders(
      <SmartMixChip smartMix={{ enabled: true, ready: 41, total: 48 }} />,
    );
    const chip = screen.getByText("41/48").closest("[data-smart-mix=chip]");
    expect(chip).toHaveAttribute("data-tone", "accent");
    expect(chip?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("says Smart Mix once every track has stems", () => {
    renderWithListenProviders(
      <SmartMixChip smartMix={{ enabled: true, ready: 118, total: 118 }} />,
    );
    expect(screen.getByText("Smart Mix")).toBeInTheDocument();
  });

  it("shows only the icon on phones once ready, still named", () => {
    breakpoint.desktop = false;
    const { rerender } = renderWithListenProviders(
      <SmartMixChip smartMix={{ enabled: true, ready: 118, total: 118 }} />,
    );
    const icon = screen.getByRole("img", {
      name: "Smart Mix · all 118 tracks have stems",
    });
    expect(icon).toHaveAttribute("data-variant", "icon");
    expect(screen.queryByText("Smart Mix")).toBeNull();

    // While it separates, phones keep the count.
    rerender(
      <SmartMixChip smartMix={{ enabled: true, ready: 9, total: 20 }} />,
    );
    expect(screen.getByText("9/20")).toBeInTheDocument();
  });

  it("marks nothing while Smart Mix is off", () => {
    const { container } = renderWithListenProviders(
      <SmartMixChip smartMix={{ enabled: false, ready: 0, total: 0 }} />,
    );
    expect(container.querySelector("[data-smart-mix=chip]")).toBeNull();
  });

  it("translates its label", () => {
    renderWithListenProviders(
      <SmartMixChip smartMix={{ enabled: true, ready: 41, total: 48 }} />,
      { locale: "es" },
    );
    expect(
      screen.getByText("41/48").closest("[data-smart-mix=chip]"),
    ).toBeInTheDocument();
  });
});
