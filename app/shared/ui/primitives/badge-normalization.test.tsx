import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CrateBadge, CrateChip, CratePill } from "./CrateBadge";
import { Badge } from "../shadcn/badge";

// A change that reintroduces a tiny/rectangular legacy badge must fail here.
describe("informative badge normalization", () => {
  it("uses one informative recipe for all existing APIs, without control semantics", () => {
    render(
      <>
        <CrateChip>Tracks</CrateChip>
        <CrateBadge>Offline</CrateBadge>
        <Badge>Ready</Badge>
        <CratePill>Imported</CratePill>
      </>,
    );
    for (const text of ["Tracks", "Offline", "Ready", "Imported"]) {
      const badge = screen.getByText(text).closest(".crate-info-badge")!;
      expect(badge).toHaveClass(
        "crate-info-badge",
        "text-info-badge",
        "font-mono",
      );
      expect(badge).not.toHaveAttribute("aria-pressed");
      expect(badge.tagName).toBe("SPAN");
    }
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("keeps metadata geometry constant across legacy size requests and icons", () => {
    render(
      <>
        <CrateBadge size="sm">Small</CrateBadge>
        <CrateBadge size="md">Medium</CrateBadge>
      </>,
    );
    expect(screen.getByText("Small").className).toBe(
      screen.getByText("Medium").className,
    );
  });
  it("lets a Badge link preserve native navigation and accessible name", () => {
    render(
      <Badge asChild>
        <a href="/library">Library</a>
      </Badge>,
    );
    expect(screen.getByRole("link", { name: "Library" })).toHaveAttribute(
      "href",
      "/library",
    );
    expect(screen.getByRole("link")).toHaveClass("crate-info-badge");
  });
});
