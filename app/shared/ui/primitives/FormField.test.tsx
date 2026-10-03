import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Input } from "@crate/ui/shadcn/input";
import { FormField } from "./FormField";
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
});
