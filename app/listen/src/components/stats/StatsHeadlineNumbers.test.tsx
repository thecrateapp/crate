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

const previous = {
  start: "2026-08-22",
  end: "2026-09-20",
  minutes_listened: 100,
  play_count: 200,
  active_days: 0,
  artist_count: 20,
};

it("shows signed deltas against the previous period", () => {
  renderWithListenProviders(
    <StatsHeadlineNumbers
      minutes={112}
      plays={194}
      activeDays={5}
      artists={20}
      today={null}
      comparison={{ previous, caption: "vs previous 30 days" }}
    />,
    { locale: "en" },
  );
  expect(screen.getByText("+12%")).toBeVisible();
  expect(screen.getByText("−3%")).toBeVisible();
  expect(screen.getByText("0%")).toBeVisible();
  // previous active_days is 0: no meaningful ratio
  expect(screen.getByText("—")).toBeVisible();
  expect(screen.getByText("vs previous 30 days")).toBeVisible();
});

it("keeps each delta in a dd of its metric group", () => {
  const { container } = renderWithListenProviders(
    <StatsHeadlineNumbers
      minutes={112}
      plays={194}
      activeDays={5}
      artists={20}
      today={{ day: "2026-10-21", timezone: "UTC", minutes: 7, plays: 2 }}
      comparison={{ previous, caption: "vs previous 30 days" }}
    />,
    { locale: "en" },
  );
  const list = container.querySelector("dl")!;
  // A dl holds only div groups of dt followed by dd (axe "dlitem").
  for (const group of Array.from(list.children)) {
    expect(group.tagName).toBe("DIV");
    const tags = Array.from(group.children).map((child) => child.tagName);
    expect(tags[0]).toBe("DT");
    expect(tags.slice(1).every((tag) => tag === "DD")).toBe(true);
  }
  const delta = screen.getByText("+12%");
  expect(delta.closest("dd")).not.toBeNull();
  expect(delta.closest("div")?.querySelector("dt")).toHaveTextContent(
    "minutes",
  );
});

it("shows a no-previous note when the period has no previous data", () => {
  renderWithListenProviders(
    <StatsHeadlineNumbers
      minutes={1}
      plays={1}
      activeDays={1}
      artists={null}
      today={null}
      comparison={{ previous: null, caption: "vs previous 30 days" }}
    />,
    { locale: "en" },
  );
  expect(screen.getByText("No previous period")).toBeVisible();
});

it("hides comparison for all time", () => {
  renderWithListenProviders(
    <StatsHeadlineNumbers
      minutes={1}
      plays={1}
      activeDays={1}
      artists={1}
      today={null}
      comparison={null}
    />,
    { locale: "en" },
  );
  expect(screen.queryByText(/vs previous/)).not.toBeInTheDocument();
  expect(screen.queryByText("No previous period")).not.toBeInTheDocument();
  expect(screen.queryByText("—")).not.toBeInTheDocument();
});
