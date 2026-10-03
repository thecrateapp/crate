import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  SegmentedControl,
  type SegmentedControlProps,
} from "./SegmentedControl";

const ITEMS = [
  { value: "albums", label: "Albums" },
  { value: "artists", label: "Artists", disabled: true },
  { value: "tracks", label: "Tracks" },
  { value: "playlists", label: "Playlists" },
] as const;

type Value = (typeof ITEMS)[number]["value"];

function Harness(
  props: Partial<SegmentedControlProps<Value>> & {
    onChange?: (v: Value) => void;
  },
) {
  const [value, setValue] = useState<Value>("albums");
  return (
    <SegmentedControl<Value>
      items={ITEMS}
      value={value}
      label="Library view"
      onValueChange={(next) => {
        setValue(next);
        props.onChange?.(next);
      }}
      {...props}
    />
  );
}

describe("SegmentedControl", () => {
  it("renders tabs with roving tabindex by default", () => {
    render(<Harness />);
    expect(
      screen.getByRole("tablist", { name: "Library view" }),
    ).toBeInTheDocument();
    const albums = screen.getByRole("tab", { name: "Albums" });
    expect(albums).toHaveAttribute("aria-selected", "true");
    expect(albums).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Tracks" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("moves with arrow keys, skipping disabled items and wrapping", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole("tab", { name: "Albums" }));
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Tracks" })).toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith("tracks");

    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Playlists" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Albums" })).toHaveFocus();

    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Playlists" })).toHaveFocus();

    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Albums" })).toHaveFocus();
  });

  it("renders as a radio group", async () => {
    render(<Harness as="radio" />);
    expect(
      screen.getByRole("radiogroup", { name: "Library view" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Tracks" }));
    expect(screen.getByRole("radio", { name: "Tracks" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("applies variants and sizes", () => {
    render(<Harness variant="tonal" size="sm" />);
    const selected = screen.getByRole("tab", { name: "Albums" });
    expect(selected).toHaveClass(
      "bg-accent-action/12",
      "h-7",
      "focus-visible:shadow-focus",
    );
  });

  it("does not fire for the current value", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole("tab", { name: "Albums" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
