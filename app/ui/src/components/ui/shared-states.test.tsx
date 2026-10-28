import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CardSkeleton, TableSkeleton, ErrorState } from "./index";
import { GridSkeleton } from "./grid-skeleton";

it("keeps the Admin barrel's skeleton contracts through the shared implementations", () => {
  const { container } = render(
    <>
      <CardSkeleton />
      <GridSkeleton count={3} columns="grid-cols-2" />
      <TableSkeleton rows={2} columns={3} />
    </>,
  );
  expect(screen.getAllByRole("status")).toHaveLength(3);
  expect(
    container.querySelectorAll('[data-slot="skeleton-cover"]'),
  ).toHaveLength(3);
  expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(container.querySelectorAll("tbody td")).toHaveLength(6);
  expect(container.querySelector(".animate-pulse, .animate-spin")).toBeNull();
});
it("keeps named retryable errors available from the Admin barrel", () => {
  const { container } = render(
    <ErrorState title="Failed to load" onRetry={() => {}} />,
  );
  expect(
    screen.getByRole("alert", { name: "Failed to load" }),
  ).toBeInTheDocument();
  expect(container.querySelector("svg")).toBeNull();
});
