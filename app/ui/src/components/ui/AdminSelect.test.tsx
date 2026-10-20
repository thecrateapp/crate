import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AdminSelect } from "./AdminSelect";

describe("AdminSelect", () => {
  it("exposes an accessible name through ariaLabel and shows its options", async () => {
    const user = userEvent.setup();
    render(
      <AdminSelect
        value=""
        onChange={vi.fn()}
        options={[{ value: "a", label: "Option A" }]}
        placeholder="Choose one"
        ariaLabel="Model"
      />,
    );

    const trigger = screen.getByRole("button", { name: "Model" });
    await user.click(trigger);

    expect(screen.getByText("Option A")).toBeVisible();
  });
});
