import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PlayerSurfaceMode } from "@/lib/player-visualizer-prefs";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "player.surface.label": "Player surface",
        "player.surface.cd": "CD",
        "player.surface.cover": "Cover",
        "player.surface.visualizer": "Visualizer",
      })[key] ?? key,
  }),
}));

import { PlayerSurfaceModeSwitch } from "./PlayerSurfaceModeSwitch";

describe("PlayerSurfaceModeSwitch", () => {
  it("uses unboxed canonical icon actions and exposes the selected player mode as a radio", () => {
    render(<PlayerSurfaceModeSwitch mode="cd" onChange={vi.fn()} />);

    expect(
      screen.getByRole("radiogroup", { name: "Player surface" }),
    ).not.toHaveAttribute("data-slot", "segmented-control");
    expect(screen.getByRole("radio", { name: "CD" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "CD" })).toHaveAttribute(
      "data-state",
      "active",
    );
    expect(screen.getByRole("radio", { name: "Cover" })).not.toBeChecked();
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toHaveAttribute("data-slot", "button");
      expect(radio).toHaveAttribute("data-variant", "ghost");
      expect(radio).not.toHaveClass("crate-form-chip");
    }
    expect(
      screen.getByRole("radio", { name: "CD" }).querySelector("svg"),
    ).toHaveClass("text-accent-action-hi");
    expect(
      screen.getByRole("radio", { name: "Cover" }).querySelector("svg"),
    ).toHaveClass("text-text-primary");
  });

  it("notifies the selected mode and preserves the visualizer capability gate", () => {
    const onChange = vi.fn<(mode: PlayerSurfaceMode) => void>();

    render(
      <PlayerSurfaceModeSwitch
        mode="cd"
        onChange={onChange}
        allowVisualizer={false}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Cover" }));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("cover");
    expect(
      screen.queryByRole("radio", { name: "Visualizer" }),
    ).not.toBeInTheDocument();
  });

  it("changes the mode with arrow keys without submitting a surrounding form", () => {
    const onChange = vi.fn<(mode: PlayerSurfaceMode) => void>();
    const onSubmit = vi.fn();
    render(
      <form onSubmit={onSubmit}>
        <PlayerSurfaceModeSwitch mode="cd" onChange={onChange} />
      </form>,
    );
    const cd = screen.getByRole("radio", { name: "CD" });
    cd.focus();

    fireEvent.keyDown(cd, { key: "ArrowRight" });

    expect(screen.getByRole("radio", { name: "Cover" })).toHaveFocus();
    expect(onChange).toHaveBeenCalledWith("cover");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
