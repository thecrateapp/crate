import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { refetchMock, useApiMock } = vi.hoisted(() => ({
  refetchMock: vi.fn(),
  useApiMock: vi.fn(),
}));

vi.mock("@/hooks/use-api", () => ({ useApi: useApiMock }));

import { Insights } from "./Insights";

const insightData = {
  countries: { Spain: 20 },
  bpm_distribution: [],
  energy_danceability: [],
  top_genres: [{ genre: "post-metal", artists: 8, albums: 21 }],
  popularity: [
    {
      artist: "Caspian",
      popularity: 76,
      listeners: 80000,
      albums: 6,
    },
  ],
  albums_by_decade: { "2020s": 24 },
  top_albums: [],
  acoustic_instrumental: [],
  feature_coverage: [],
  artist_depth: [],
};

describe("Insights refresh recovery", () => {
  beforeEach(() => {
    refetchMock.mockReset();
    useApiMock.mockReturnValue({
      data: insightData,
      loading: false,
      error: "Snapshot refresh failed",
      refetch: refetchMock,
    });
  });

  it("keeps the last successful charts visible and offers a retry after refresh fails", async () => {
    const user = userEvent.setup();
    const { container } = render(<Insights />);

    expect(screen.getByRole("heading", { name: "Insights" })).toBeVisible();
    for (const label of ["Collection shape", "Standouts", "Audio signature"]) {
      expect(
        screen
          .getAllByText(label, { exact: true })
          .some((element) => element.closest('[data-slot="info-badge"]')),
      ).toBe(true);
    }
    expect(
      screen.getByText(
        "Insights could not refresh. Showing the last successful snapshot.",
      ),
    ).toBeVisible();
    expect(screen.getByText("post-metal")).toBeVisible();
    expect(screen.queryByText("Signal Brief")).not.toBeInTheDocument();
    expect(
      Array.from(container.querySelectorAll("article")).some((article) =>
        article.className.includes("bg-raised-surface"),
      ),
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });
});
