import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TableSkeleton } from "./table-skeleton";

describe("TableSkeleton", () => {
  it("renders default rows and columns", () => {
    const { container } = render(<TableSkeleton />);
    const rows = container.querySelectorAll(".flex.gap-4.p-3");
    expect(rows.length).toBe(6); // header + 5 rows
  });

  it("renders custom rows and columns", () => {
    const { container } = render(<TableSkeleton rows={3} columns={2} />);
    const rows = container.querySelectorAll(".flex.gap-4.p-3");
    expect(rows.length).toBe(4); // header + 3 rows
  });
});
