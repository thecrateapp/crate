import { useState, type ComponentProps } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { FormField } from "../primitives/FormField";
import { AdminSelect } from "./AdminSelect";

const OPTIONS = [
  {
    value: "ambient",
    label: "Ambient",
    count: 0,
    searchText: "drone atmospheric",
  },
  { value: "jazz", label: "Jazz", count: 12, searchText: "improvised" },
  { value: "classical", label: "Classical", count: "50+" },
  { value: "electronic", label: "Electronic", count: null },
  { value: "folk", label: "Folk" },
  { value: "pop", label: "Pop" },
  { value: "rock", label: "Rock" },
  { value: "techno", label: "Techno" },
];

function Harness(props: Partial<ComponentProps<typeof AdminSelect>> = {}) {
  const [value, setValue] = useState(props.value ?? "jazz");
  return (
    <AdminSelect
      options={OPTIONS}
      placeholder="All genres"
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        props.onChange?.(next);
      }}
    />
  );
}

function expectActiveOption(name: string | RegExp) {
  const option = within(screen.getByRole("listbox")).getByRole("option", {
    name,
  });
  const focused = document.activeElement;
  const activeDescendant =
    Boolean(option.id) &&
    focused?.getAttribute("aria-activedescendant") === option.id;
  expect(focused === option || activeDescendant).toBe(true);
}

describe("AdminSelect", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it.each([
    { label: "plain", searchable: false },
    { label: "searchable", searchable: true },
  ])(
    "keeps the $label trigger named by its field when the selected value changes",
    async ({ searchable }) => {
      render(<Harness searchable={searchable} />);
      const trigger = screen.getByRole("combobox", { name: "All genres" });
      expect(trigger).toHaveAccessibleName("All genres");
      expect(trigger).toHaveTextContent("Jazz");

      await userEvent.click(trigger);
      await userEvent.click(screen.getByRole("option", { name: /^Ambient/ }));

      expect(trigger).toHaveTextContent("Ambient");
      expect(trigger).toHaveAccessibleName("All genres");
      expect(screen.getByRole("combobox", { name: "All genres" })).toBe(
        trigger,
      );
    },
  );

  it("exposes the selected value and preserves zero and string option counts", async () => {
    render(<Harness searchable />);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent("Jazz");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveClass("crate-form-control");
    await userEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    const listbox = screen.getByRole("listbox");
    expect(trigger).toHaveAttribute("aria-controls", listbox.id);
    expect(
      within(listbox).getByRole("option", { name: /^Jazz/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      within(
        within(listbox).getByRole("option", { name: /^Ambient/ }),
      ).getByText("0"),
    ).toBeVisible();
    expect(
      within(
        within(listbox).getByRole("option", { name: /^Classical/ }),
      ).getByText("50+"),
    ).toBeVisible();
    expect(
      within(listbox).getByRole("option", { name: "Electronic" }),
    ).toBeVisible();
  });

  it("filters labels and searchText, names empty results, and resets on dismissal", async () => {
    render(
      <Harness
        searchable
        searchPlaceholder="Find genre"
        noMatchesLabel="No matching genre"
      />,
    );
    const trigger = screen.getByRole("combobox");
    await userEvent.click(trigger);
    const search = screen.getByRole("searchbox");
    expect(search).toHaveAttribute("placeholder", "Find genre");
    await waitFor(() => expect(search).toHaveFocus());

    await userEvent.type(search, "  DRONE  ");
    expect(screen.getByRole("option", { name: /^Ambient/ })).toBeVisible();
    expect(
      screen.queryByRole("option", { name: /^Jazz/ }),
    ).not.toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, "JAZ");
    expect(screen.getByRole("option", { name: /^Jazz/ })).toBeVisible();
    await userEvent.clear(search);
    await userEvent.type(search, "unmatched");
    expect(screen.getByText("No matching genre")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await userEvent.click(trigger);
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("option", { name: /^Ambient/ })).toBeVisible();
    expect(screen.getByRole("option", { name: "Techno" })).toBeVisible();
  });

  it("selects the first filtered match with Enter even when clearing is allowed", async () => {
    const onChange = vi.fn();
    render(<Harness searchable allowClear onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    await userEvent.click(trigger);
    const search = screen.getByRole("searchbox");
    await userEvent.type(search, "drone");
    expect(screen.getByRole("option", { name: /^Ambient/ })).toBeVisible();
    expect(search).toHaveFocus();

    await userEvent.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("ambient");
    expect(onChange).not.toHaveBeenCalledWith("");
    expect(trigger).toHaveTextContent("Ambient");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps the current value and menu open when Enter has no filtered match", async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn((event) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Harness
          searchable
          allowClear
          onChange={onChange}
          noMatchesLabel="No matching genre"
        />
        <button type="submit">Save</button>
      </form>,
    );
    const trigger = screen.getByRole("combobox");
    await userEvent.click(trigger);
    const search = screen.getByRole("searchbox");
    await userEvent.type(search, "unmatched");
    expect(screen.getByText("No matching genre")).toBeVisible();

    await userEvent.keyboard("{Enter}");

    expect(onChange).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(trigger).toHaveTextContent("Jazz");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeVisible();
    expect(search).toHaveValue("unmatched");
    expect(search).toHaveFocus();
  });

  it.each([
    { label: "active composition", isComposing: true, keyCode: 229 },
    { label: "Safari composition-end", isComposing: false, keyCode: 229 },
  ])(
    "keeps $label key events in the search field during IME input",
    async ({ isComposing, keyCode }) => {
      const onChange = vi.fn();
      render(<Harness searchable allowClear onChange={onChange} />);
      const trigger = screen.getByRole("combobox");
      await userEvent.click(trigger);
      const search = screen.getByRole("searchbox");
      await userEvent.type(search, "drone");
      expect(screen.getByRole("option", { name: /^Ambient/ })).toBeVisible();

      for (const key of ["ArrowDown", "ArrowUp", "Enter"]) {
        fireEvent.keyDown(search, { key, isComposing, keyCode });
        expect(onChange).not.toHaveBeenCalled();
        expect(trigger).toHaveTextContent("Jazz");
        expect(trigger).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByRole("listbox")).toBeVisible();
        expect(search).toHaveValue("drone");
        expect(search).toHaveFocus();
      }

      await userEvent.keyboard("{Enter}");

      expect(onChange).toHaveBeenCalledOnce();
      expect(onChange).toHaveBeenCalledWith("ambient");
      expect(trigger).toHaveTextContent("Ambient");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      await waitFor(() => expect(trigger).toHaveFocus());
    },
  );

  it("supports searchable option navigation with arrows, Home, End and Enter", async () => {
    const onChange = vi.fn();
    render(<Harness searchable allowClear={false} onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveFocus());

    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Home}");
    expectActiveOption(/^Ambient/);
    await userEvent.keyboard("{ArrowDown}");
    expectActiveOption(/^Jazz/);
    await userEvent.keyboard("{End}");
    expectActiveOption("Techno");
    await userEvent.keyboard("{ArrowUp}");
    expectActiveOption("Rock");
    await userEvent.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith("rock");
    expect(trigger).toHaveTextContent("Rock");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps keyboard selection and Escape focus restoration without search", async () => {
    const onChange = vi.fn();
    render(<Harness allowClear={false} onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("listbox")).toBeVisible();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    await userEvent.keyboard("{End}{Enter}");
    expect(onChange).toHaveBeenCalledWith("techno");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveTextContent("Techno");

    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("clears the selected value without submitting its surrounding form", async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn((event) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Harness searchable onChange={onChange} />
      </form>,
    );
    const trigger = screen.getByRole("combobox");
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("option", { name: /^All genres/ }));

    expect(onChange).toHaveBeenCalledWith("");
    expect(trigger).toHaveTextContent("All genres");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("preserves the clear opt-out and custom trigger and menu classes", async () => {
    render(
      <Harness
        searchable
        allowClear={false}
        triggerClassName="custom-trigger"
        menuClassName="custom-menu"
      />,
    );
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveClass("custom-trigger");
    await userEvent.click(trigger);
    expect(
      screen.queryByRole("option", { name: /^All genres/ }),
    ).not.toBeInTheDocument();
    const customMenu = document.querySelector(".custom-menu");
    expect(customMenu).toBeInTheDocument();
    expect(customMenu?.contains(screen.getByRole("listbox"))).toBe(true);
  });

  it("keeps disabled selects closed for pointer and keyboard interaction", async () => {
    const onChange = vi.fn();
    render(<Harness disabled onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toBeDisabled();
    await userEvent.click(trigger);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}{ArrowDown}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "preserves FormField label, errors and required state (searchable=%s)",
    async (searchable) => {
      render(
        <FormField
          id="format"
          label="Audio format"
          hint="Choose a format"
          error="Required"
          required
        >
          {(control) => (
            <AdminSelect
              {...control}
              options={OPTIONS}
              placeholder="Choose"
              value="jazz"
              onChange={() => {}}
              searchable={searchable}
            />
          )}
        </FormField>,
      );
      const trigger = screen.getByRole("combobox", { name: "Audio format" });
      expect(trigger).toHaveAttribute("id", "format");
      expect(trigger).toHaveAccessibleDescription("Choose a format Required");
      expect(trigger).toHaveAttribute("aria-invalid", "true");
      expect(trigger).toHaveAttribute("aria-required", "true");
      await userEvent.click(trigger);
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    },
  );
});
