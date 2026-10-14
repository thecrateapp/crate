import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusDot } from "./StatusDot";

describe("StatusDot", () => {
  it("renders a filled accent dot with a mono label when on", () => {
    const { container } = render(<StatusDot label="In library" />);

    const root = container.firstElementChild!;
    expect(root).toHaveAttribute("data-tone", "on");
    expect(root).toHaveClass("text-accent-action-hi", "font-mono", "uppercase");
    expect(root.querySelector("[aria-hidden='true']")).toHaveClass(
      "bg-current",
    );
    expect(screen.getByText("In library")).toBeInTheDocument();
  });

  it("renders a hollow ring in the subtle tone when off", () => {
    const { container } = render(<StatusDot tone="off" label="Missing" />);

    const root = container.firstElementChild!;
    expect(root).toHaveClass("text-text-subtle");
    expect(root.querySelector("[aria-hidden='true']")).toHaveClass(
      "border",
      "border-current",
    );
  });

  it("keeps amber for warning status only", () => {
    const { container } = render(<StatusDot tone="warn" label="No preset" />);

    expect(container.firstElementChild).toHaveClass("text-state-warning-text");
  });

  it("exposes a dot without a label as an image named by its title", () => {
    render(<StatusDot title="Attending" />);

    expect(screen.getByRole("img", { name: "Attending" })).toBeInTheDocument();
  });
});
