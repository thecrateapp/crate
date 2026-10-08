import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { WindowPicker } from "./StatsPanels";

describe("WindowPicker", () => {
  it("marks the active window with the semantic accent shadow", () => {
    renderWithListenProviders(<WindowPicker value="7d" onChange={vi.fn()} />);

    const active = screen.getByRole("radio", { name: "7D" });
    expect(active).toHaveAttribute("aria-checked", "true");
    expect(active.className).toContain("shadow-accent-action");
  });

  it("selects a window even when a month is active", () => {
    const onChange = vi.fn();
    renderWithListenProviders(
      <WindowPicker value={null} onChange={onChange} />,
    );

    expect(
      screen.getByRole("radiogroup", { name: "Time range" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: "30D" }));

    expect(onChange).toHaveBeenCalledWith("30d");
  });
});
