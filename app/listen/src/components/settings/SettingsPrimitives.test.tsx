import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  RangeRow,
  Section,
  ToggleRow,
} from "@/components/settings/SettingsPrimitives";

describe("settings primitives", () => {
  it("renders a section heading and description around its content", () => {
    render(
      <Section title="Playback" description="Tune your listening experience.">
        <span>Controls</span>
      </Section>,
    );

    const section = screen.getByRole("region", { name: "Playback" });
    expect(section.tagName).toBe("SECTION");
    expect(section).toHaveClass(
      "border-t",
      "border-border-quiet",
      "@container",
    );
    expect(
      within(section).getByRole("heading", { level: 2, name: "Playback" }),
    ).toBeInTheDocument();
    expect(
      within(section).getByText("Tune your listening experience."),
    ).toBeInTheDocument();
    expect(within(section).getByText("Controls")).toBeInTheDocument();
  });

  it("reports numeric range changes", () => {
    const onChange = vi.fn();

    render(
      <RangeRow
        label="Crossfade"
        value={4}
        min={0}
        max={12}
        step={1}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("slider", { name: "Crossfade" }), {
      target: { value: "8" },
    });

    expect(onChange).toHaveBeenCalledWith(8);
  });

  it("exposes toggle state and reports the next value", () => {
    const onChange = vi.fn();

    render(
      <ToggleRow
        label="Smart transitions"
        checked={false}
        onChange={onChange}
      />,
    );

    const toggle = screen.getByRole("switch", { name: "Smart transitions" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith(true);
  });
});
