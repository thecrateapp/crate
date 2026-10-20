import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CardSkeleton } from "./CardSkeleton";
import { GridSkeleton } from "./GridSkeleton";
import { TableSkeleton } from "./TableSkeleton";
import { Skeleton } from "../shadcn/skeleton";

describe("reserved static loading geometry", () => {
  it("keeps Skeleton dimensions and caller attributes without shimmer", () => {
    const { container } = render(
      <Skeleton className="h-8 w-20" data-testid="reading" />,
    );
    expect(screen.getByTestId("reading")).toHaveClass("h-8", "w-20");
    expect(screen.getByTestId("reading")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(container.querySelector(".animate-pulse, .animate-spin")).toBeNull();
  });
  it("names a summary loading state and reserves its two readings", () => {
    const { container } = render(<CardSkeleton label="Loading summary" />);
    expect(
      screen.getByRole("status", { name: "Loading summary" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
      2,
    );
    expect(container.textContent).not.toContain("—");
  });
  it.each([CardSkeleton, GridSkeleton, TableSkeleton])(
    "does not suppress its named loading announcement",
    (Placeholder) => {
      render(<Placeholder label="Loading data" />);
      expect(
        screen.getByRole("status", { name: "Loading data" }),
      ).not.toHaveAttribute("aria-busy", "true");
    },
  );
  it("supports media-specific shells and real rail columns", () => {
    const { container } = render(
      <GridSkeleton
        layout="rail"
        variant="artist"
        count={3}
        label="Loading artists"
      />,
    );
    expect(screen.getByTestId("media-rail")).toHaveAttribute(
      "data-rail-fit",
      "columns",
    );
    expect(
      container.querySelectorAll(
        '[data-slot="skeleton-cover"][data-variant="artist"]',
      ),
    ).toHaveLength(3);
  });
  it("retains the default/custom media count and responsive column contract", () => {
    const { container, rerender } = render(
      <GridSkeleton label="Loading albums" />,
    );
    expect(
      screen.getByRole("status", { name: "Loading albums" }),
    ).toBeInTheDocument();
    expect(
      container.querySelectorAll('[data-slot="skeleton-cover"]'),
    ).toHaveLength(12);
    rerender(
      <GridSkeleton count={3} columns="grid-cols-2" label="Loading albums" />,
    );
    expect(
      container.querySelectorAll('[data-slot="skeleton-cover"]'),
    ).toHaveLength(3);
    expect(screen.getByRole("status")).toHaveClass("grid-cols-2");
    expect(container.querySelector(".animate-pulse, .animate-spin")).toBeNull();
    expect(container.textContent).not.toContain("—");
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
      9,
    );
  });
  it("reserves the default/custom number of table rows and columns", () => {
    const { container, rerender } = render(
      <TableSkeleton label="Loading tracks" />,
    );
    expect(
      screen.getByRole("status", { name: "Loading tracks" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(5);
    expect(
      container.querySelectorAll('tbody [data-slot="skeleton"]'),
    ).toHaveLength(20);
    expect(container.querySelector("table")?.textContent).toBe("");
    expect(container.querySelectorAll("thead th")).toHaveLength(4);
    rerender(<TableSkeleton rows={3} columns={2} />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(container.querySelectorAll("tbody td")).toHaveLength(6);
  });
});
