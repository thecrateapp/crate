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
  it("uses semantic tokens for boxed active and inactive modes", () => {
    render(
      <PlayerSurfaceModeSwitch mode="cd" onChange={vi.fn()} variant="boxed" />,
    );

    expect(screen.getByRole("tablist")).toHaveClass(
      "border-border-subtle",
      "bg-surface-chrome",
    );
    expect(screen.getByRole("tab", { name: "CD" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "CD" })).toHaveClass(
      "data-[state=active]:bg-accent-action/18",
      "text-accent-action",
    );
    expect(screen.getByRole("tab", { name: "Cover" })).toHaveClass(
      "data-[state=inactive]:text-text-muted",
      "data-[state=inactive]:hover:bg-surface-control",
      "data-[state=inactive]:hover:text-text-secondary",
    );
    expect(screen.getByRole("tab", { name: "Cover" }).className).not.toContain(
      "white/",
    );
  });

  it("notifies the selected mode when a tab is clicked", () => {
    const onChange = vi.fn<(mode: PlayerSurfaceMode) => void>();

    render(
      <PlayerSurfaceModeSwitch
        mode="cd"
        onChange={onChange}
        allowVisualizer={false}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Cover" }));

    expect(onChange).toHaveBeenCalledWith("cover");
    expect(
      screen.queryByRole("tab", { name: "Visualizer" }),
    ).not.toBeInTheDocument();
  });
});
