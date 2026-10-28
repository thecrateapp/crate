import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge shared adapter", () => {
  it.each([
    ["neutral", "neutral"],
    ["info", "accent"],
    ["success", "accent"],
    ["warning", "warning"],
    ["danger", "warning"],
  ] as const)(
    "preserves Admin %s semantics with shared %s presentation",
    (tone, presentation) => {
      render(<StatusBadge tone={tone}>Connected</StatusBadge>);
      const badge = screen.getByText("Connected");
      expect(badge).toHaveAttribute("data-status-tone", tone);
      expect(badge).toHaveAttribute("data-tone", presentation);
      expect(badge).toHaveAttribute("data-slot", "info-badge");
      expect(badge).toHaveClass("crate-info-badge", "font-mono", "font-normal");
      expect(badge).not.toHaveClass(
        "font-medium",
        "py-0.5",
        "bg-raised-surface",
      );
    },
  );
});
