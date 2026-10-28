import { screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { RadioStationRail } from "./RadioStationRail";

it("reserves the square station rail while its source loads", () => {
  const { container } = renderWithListenProviders(
    <RadioStationRail
      title="Radio"
      subtitle="Stations"
      stations={[]}
      loading
      disabled={false}
      onStart={vi.fn()}
    />,
  );
  expect(screen.getByTestId("media-rail")).toHaveAttribute(
    "data-rail-fit",
    "columns",
  );
  expect(
    container.querySelectorAll(
      '[data-slot="skeleton-cover"][data-variant="station"]',
    ),
  ).toHaveLength(5);
  expect(container.querySelector('[data-slot="skeleton-table"]')).toBeNull();
});
