import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge, type StatusTone } from "./StatusBadge";

describe("StatusBadge", () => {
  it.each([
    ["neutral", "border-border-quiet", "bg-raised-surface", "text-text-subtle"],
    [
      "info",
      "border-accent-action/25",
      "bg-accent-action/10",
      "text-accent-action",
    ],
    [
      "success",
      "border-accent-action/25",
      "bg-accent-action/10",
      "text-accent-action-hi",
    ],
    [
      "warning",
      "border-state-warning/25",
      "bg-state-warning/10",
      "text-state-warning-text",
    ],
    [
      "danger",
      "border-state-warning/25",
      "bg-state-warning/10",
      "text-state-warning-text",
    ],
  ] as const)("uses shared semantic tokens for %s", (tone, ...classes) => {
    render(<StatusBadge tone={tone as StatusTone}>Connected</StatusBadge>);
    const badge = screen.getByText("Connected");
    expect(badge).toHaveAttribute("data-tone", tone);
    expect(badge).toHaveClass(...classes);
  });
});
