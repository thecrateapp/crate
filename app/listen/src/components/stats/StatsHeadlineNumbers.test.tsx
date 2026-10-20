import { screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { StatsHeadlineNumbers } from "./StatsHeadlineNumbers";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
it("keeps confirmed zero readings and uses canonical metric captions", () => {
  const { container } = renderWithListenProviders(
    <StatsHeadlineNumbers
      minutes={0}
      plays={12}
      activeDays={3}
      artists={null}
      today={null}
    />,
    { locale: "en" },
  );
  expect(screen.getByText("0", { exact: true })).toBeVisible();
  expect(screen.getByText("minutes", { exact: true })).toHaveClass(
    "font-mono",
    "uppercase",
  );
  expect(container.querySelectorAll("dd .font-display")).toHaveLength(3);
  expect(
    screen.queryByText("artists", { exact: true }),
  ).not.toBeInTheDocument();
});
