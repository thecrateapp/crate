import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { StatsDecadeColumns } from "./StatsClosingCards";
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
