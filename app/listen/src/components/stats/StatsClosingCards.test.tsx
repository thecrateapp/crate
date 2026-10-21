import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { StatsDecadeColumns } from "./StatsClosingCards";
import { StatsMusicAgeCardView } from "./StatsClosingViews";
import type { StatsMusicAge } from "./stats-model";

const musicAge: StatsMusicAge = {
  median_year: 2014,
  decades: [
    {
      decade: 2000,
      share: 0.3,
      top_album: {
        album: "Jane Doe",
        artist: "Converge",
        album_id: 18,
        album_slug: "converge-jane-doe",
        year: 2001,
      },
    },
    { decade: 2010, share: 0.7, top_album: null },
  ],
};

describe("StatsDecadeColumns", () => {
  it("links each decade to its most played record and highlights the median", () => {
    const { container } = renderWithListenProviders(
      <StatsDecadeColumns musicAge={musicAge} linked />,
    );

    const link = screen.getByRole("link", {
      name: "2000s, 30% of your listening. Top record: Jane Doe by Converge",
    });
    expect(link).toHaveAttribute("href", "/artists/converge/jane-doe");
    expect(container.querySelectorAll(".stats-decade-cover")).toHaveLength(1);
    expect(container.querySelector('[data-hot="true"]')).toHaveTextContent(
      "10s70%",
    );
  });

  it("renders plain columns for the story", () => {
    renderWithListenProviders(<StatsDecadeColumns musicAge={musicAge} />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("StatsMusicAgeCardView", () => {
  it("shows newest album and this year's share", () => {
    renderWithListenProviders(
      <StatsMusicAgeCardView
        musicAge={{
          ...musicAge,
          oldest_album: { album: "Jane Doe", year: 2001 },
          newest_album: { album: "Fresh Cut", year: 2026 },
          share_this_year: 0.18,
        }}
        decades={null}
      />,
    );

    expect(
      screen.getByText("Your oldest record this period: Jane Doe (2001)."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Your newest record this period: Fresh Cut (2026)."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("18% of your listening is from this year."),
    ).toBeInTheDocument();
  });

  it("keeps a real zero share and hides an unknown one", () => {
    const { rerender } = renderWithListenProviders(
      <StatsMusicAgeCardView
        musicAge={{ ...musicAge, share_this_year: 0 }}
        decades={null}
      />,
    );
    expect(
      screen.getByText("0% of your listening is from this year."),
    ).toBeInTheDocument();

    rerender(
      <StatsMusicAgeCardView
        musicAge={{ ...musicAge, share_this_year: null }}
        decades={null}
      />,
    );
    expect(screen.queryByText(/from this year/)).not.toBeInTheDocument();
  });
});
