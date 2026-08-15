import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { ArtistCard } from "./ArtistCard";
import { ArtistRow } from "./ArtistRow";

describe("featured artist indicators", () => {
  it("shows Featured and device readiness in the grid card", () => {
    render(
      <MemoryRouter>
        <ArtistCard
          name="Converge"
          artistId={7}
          albums={3}
          tracks={20}
          size_mb={100}
          primary_format="flac"
          isFeatured
          featuredDevices={["desktop", "mobile"]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Featured")).toBeInTheDocument();
    expect(screen.getByText("desktop")).toBeInTheDocument();
    expect(screen.getByText("mobile")).toBeInTheDocument();
  });

  it("shows Featured in the list row", () => {
    render(
      <MemoryRouter>
        <ArtistRow
          name="Converge"
          artistId={7}
          albums={3}
          tracks={20}
          total_size_mb={100}
          isFeatured
          featuredDevices={["desktop"]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Featured")).toBeInTheDocument();
    expect(screen.getByText("desktop")).toBeInTheDocument();
  });
});
