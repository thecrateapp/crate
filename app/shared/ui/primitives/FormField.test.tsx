import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Input } from "@crate/ui/shadcn/input";
import { FormField } from "./FormField";
import { RadioGroup, RadioGroupItem } from "./RadioGroup";
import { SegmentedControl } from "./SegmentedControl";
import { Checkbox } from "./Checkbox";
import userEvent from "@testing-library/user-event";
import { Switch } from "./Switch";

describe("FormField", () => {
  it("links the label to the cloned control", () => {
    render(
      <FormField label="Name">
        <Input />
      </FormField>,
    );
    expect(screen.getByLabelText("Name")).toBe(screen.getByRole("textbox"));
  });

  it("wires hint and error into aria-describedby and aria-invalid", () => {
    render(
      <FormField label="Email" hint="We never share it" error="Required">
        <Input aria-describedby="external" />
      </FormField>,
    );
    const input = screen.getByRole("textbox", { name: "Email" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/We never share it/);
    expect(input.getAttribute("aria-describedby")).toMatch(/^external /);
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
  });

  it("keeps the child id", () => {
    render(
      <FormField label="Title" hint="Hint">
        <Input id="title-input" />
      </FormField>,
    );
    const input = screen.getByLabelText("Title");
    expect(input).toHaveAttribute("id", "title-input");
    expect(input).toHaveAttribute("aria-describedby", "title-input-hint");
  });

  it("supports a render prop", () => {
    render(
      <FormField label="Notes" error="Too long" required>
        {(control) => <textarea {...control} />}
      </FormField>,
    );
    const textarea = screen.getByRole("textbox", { name: /Notes/ });
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea).toHaveAttribute("aria-required", "true");
    expect(textarea).toHaveAccessibleDescription("Too long");
  });

  it("omits aria-invalid and describedby without hint or error", () => {
    render(
      <FormField label="Plain">
        <Input />
      </FormField>,
    );
    const input = screen.getByRole("textbox");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("labels Radix controls", () => {
    render(
      <FormField label="Notifications">
        <Switch />
      </FormField>,
    );
    expect(
      screen.getByRole("switch", { name: "Notifications" }),
    ).toBeInTheDocument();
  });

  it("uses a warning status dot and preserves all error descriptions", () => {
    const { container } = render(
      <>
        <p id="external-help">Imported metadata</p>
        <FormField
          id="release-title"
          label="Title"
          hint="Use the release title"
          error="A title is required"
        >
          <Input id="legacy-title" aria-describedby="external-help" />
        </FormField>
      </>,
    );
    const input = screen.getByRole("textbox", { name: "Title" });
    const error = screen.getByRole("alert");
    expect(input).toHaveAttribute("id", "release-title");
    expect(input).toHaveAttribute(
      "aria-describedby",
      "external-help release-title-hint release-title-error",
    );
    expect(input).toHaveAccessibleDescription(
      "Imported metadata Use the release title A title is required",
    );
    expect(error).toHaveAttribute("id", "release-title-error");
    expect(error.querySelector('[data-tone="warn"]')).toBeInTheDocument();
    expect(error.querySelector(".crate-status-dot")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(error.textContent).toBe("A title is required");
    expect(
      Array.from(container.querySelectorAll("[class]"))
        .map((node) => node.className)
        .join(" "),
    ).not.toMatch(/state-danger/);
  });

  it("keeps generated ids stable while hint and error appear and disappear", () => {
    const { rerender } = render(
      <FormField label="Name">
        <Input />
      </FormField>,
    );
    const input = screen.getByRole("textbox", { name: "Name" });
    const id = input.id;
    expect(id).not.toBe("");
    rerender(
      <FormField label="Name" hint="Full name" error="Required">
        <Input />
      </FormField>,
    );
    expect(input).toHaveAttribute("id", id);
    expect(input).toHaveAttribute("aria-describedby", `${id}-hint ${id}-error`);
    expect(input).toHaveAttribute("aria-invalid", "true");
    rerender(
      <FormField label="Name" hint="Full name">
        <Input />
      </FormField>,
    );
    expect(input).toHaveAttribute("id", id);
    expect(input).toHaveAttribute("aria-describedby", `${id}-hint`);
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("preserves an existing invalid state when it has no field error", () => {
    render(
      <FormField label="Imported title">
        <Input aria-invalid />
      </FormField>,
    );
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });
  it("names a non-labelable control through its visible caption", () => {
    render(
      <FormField label="Quality" hint="Select one">
        <RadioGroup defaultValue="lossless">
          <RadioGroupItem value="lossless" aria-label="Lossless" />
        </RadioGroup>
      </FormField>,
    );
    expect(
      screen.getByRole("radiogroup", { name: "Quality" }),
    ).toHaveAccessibleDescription("Select one");
  });

  it("places a checkbox before its inline label and keeps label activation and descriptions", async () => {
    render(
      <FormField
        layout="inline"
        label="Keep queue"
        hint="Preserve playback"
        error="Choose a setting"
      >
        <Checkbox />
      </FormField>,
    );
    const checkbox = screen.getByRole("checkbox", { name: "Keep queue" });
    const label = screen.getByText("Keep queue").closest("label")!;
    expect(
      checkbox.compareDocumentPosition(label) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await userEvent.click(label);
    expect(checkbox).toBeChecked();
    expect(checkbox).toHaveAccessibleDescription(
      "Preserve playback Choose a setting",
    );
  });
  it("uses a group caption without a false native label target and names a segmented group", () => {
    render(
      <FormField
        kind="group"
        label="Listening mode"
        hint="Choose one mode"
        error="Choose an available mode"
        required
      >
        <SegmentedControl
          as="radio"
          label="Legacy name"
          value="all"
          onValueChange={() => {}}
          items={[
            { value: "all", label: "All" },
            { value: "local", label: "Local" },
          ]}
        />
      </FormField>,
    );
    const group = screen.getByRole("radiogroup", { name: "Listening mode" });
    expect(group).toHaveAccessibleDescription(
      "Choose one mode Choose an available mode",
    );
    expect(group).toHaveAttribute("aria-required", "true");
    expect(screen.getByText("Listening mode").closest("label")).toBeNull();
  });
});
