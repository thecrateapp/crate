import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  RangeRow,
  SelectRow,
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
    expect(section).toHaveAccessibleDescription(
      "Tune your listening experience.",
    );
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

  it("uses the actual inline FormField caption and disabled switch", () => {
    render(
      <ToggleRow
        label="Smart transitions"
        description="Preserve the queue"
        checked
        disabled
        onChange={vi.fn()}
      />,
    );
    const toggle = screen.getByRole("switch", { name: "Smart transitions" });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAccessibleDescription("Preserve the queue");
    expect(toggle.closest('[data-slot="form-field"]')).toHaveAttribute(
      "data-layout",
      "inline",
    );
    expect(screen.getByText("Smart transitions")).toHaveClass("uppercase");
  });
  it("associates scalar Select values with the canonical caption and description", () => {
    render(
      <SelectRow
        label="Density"
        description="Content spacing"
        value="compact"
        options={[
          { value: "compact", label: "Compact", description: "More content" },
          { value: "comfortable", label: "Comfortable" },
        ]}
        onChange={vi.fn()}
        disabled
      />,
    );
    const select = screen.getByRole("combobox", { name: "Density" });
    expect(select).toBeDisabled();
    expect(select).toHaveTextContent("Compact");
    expect(select).toHaveAccessibleDescription("Content spacing More content");
    expect(select.closest('[data-slot="form-field"]')).toHaveAttribute(
      "data-layout",
      "stacked",
    );
  });
  it("lets users read every option explanation before an immediate-save selection", async () => {
    const user = userEvent.setup(),
      onChange = vi.fn();
    render(
      <SelectRow
        label="Stream quality"
        value="auto"
        onChange={onChange}
        options={[
          {
            value: "auto",
            label: "Auto",
            description: "Adapts to the connection",
          },
          {
            value: "balanced",
            label: "Balanced",
            description: "Uses a lighter cached file",
          },
        ]}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Stream quality" });
    expect(trigger).toHaveTextContent(/^Auto$/);
    await user.click(trigger);
    const option = screen.getByRole("option", { name: "Balanced" });
    expect(option).toHaveAccessibleDescription("Uses a lighter cached file");
    expect(
      within(option).getByText("Uses a lighter cached file"),
    ).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
    await user.click(option);
    expect(onChange).toHaveBeenCalledWith("balanced");
  });

  it("uses the shared accent tone only for section headings", () => {
    render(
      <Section title="Interface">
        <ToggleRow label="Motion" checked onChange={vi.fn()} />
      </Section>,
    );
    expect(screen.getByRole("heading", { name: "Interface" })).toHaveClass(
      "text-accent-action-hi",
    );
    expect(screen.getByText("Motion")).not.toHaveClass("text-accent-action-hi");
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
  it("disables the actual numeric range and associates its description", () => {
    render(
      <RangeRow
        label="Crossfade"
        description="Fade between tracks"
        value={4}
        min={0}
        max={12}
        step={0.5}
        disabled
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("slider", { name: "Crossfade" })).toBeDisabled();
    expect(screen.getByRole("slider")).toHaveAccessibleDescription(
      "Fade between tracks",
    );
  });
});
