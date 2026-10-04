import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithListenProviders } from "@/test/render-with-listen-providers";

import { ReleaseRow } from "./ReleaseRow";
import type { UpcomingItem } from "./upcoming-model";

const release: UpcomingItem = {
  type: "release",
  date: "2030-01-20",
  artist: "Converge",
  artist_id: 7,
  artist_slug: "converge",
  title: "No Heroes",
  subtitle: "Album",
  cover_url: null,
  status: "announced",
  is_upcoming: true,
  album_id: 42,
  album_slug: "no-heroes",
};

describe("ReleaseRow", () => {
  it("renders the release as an article with an album link and status meta", () => {
    renderWithListenProviders(<ReleaseRow item={release} />);

    const link = screen.getByRole("link", { name: /No Heroes/ });
    expect(link.closest("article")).toHaveClass(
      "upcoming-event-row-atmosphere",
    );
    expect(link).toHaveAttribute("href", expect.stringContaining("no-heroes"));
    expect(screen.getByText("Converge · Album")).toBeInTheDocument();
    expect(screen.getByText("Pre-release")).toBeInTheDocument();
  });

  it("offers album and artist navigation from the more button", () => {
    renderWithListenProviders(<ReleaseRow item={release} />);

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(
      screen.getByRole("menuitem", { name: /Go to album/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /Go to artist/ }),
    ).toBeInTheDocument();
  });
});
