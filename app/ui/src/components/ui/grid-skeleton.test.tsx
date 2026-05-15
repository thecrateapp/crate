import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { GridSkeleton } from "./grid-skeleton";

describe("GridSkeleton", () => {
  it("renders default count of skeletons", () => {
    const { container } = render(<GridSkeleton />);
    expect(container.querySelectorAll(".bg-card").length).toBe(12);
  });

  it("renders custom count", () => {
    const { container } = render(<GridSkeleton count={3} />);
    expect(container.querySelectorAll(".bg-card").length).toBe(3);
  });

  it("applies custom columns class", () => {
    const { container } = render(<GridSkeleton columns="grid-cols-2" />);
    expect(container.firstChild).toHaveClass("grid-cols-2");
  });
});
