import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AlbumHeader } from "./AlbumHeader";

const baseProps = {
  albumId: 1,
  artist: "Converge",
  album: "Jane Doe",
  albumTags: {
    artist: "Converge",
    album: "Jane Doe",
    year: "2001",
    genre: "hardcore",
  },
  trackCount: 12,
  totalLengthSec: 2700,
  totalSizeMb: 420,
  hasCover: true,
};

function renderHeader(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("AlbumHeader", () => {
  it("keeps legacy admin actions hidden for partial metadata editors", () => {
    renderHeader(
      <AlbumHeader
        {...baseProps}
        isAdmin={false}
        canDownload
        canEditArtwork={false}
        canEnrich={false}
        canQueueMetadata={false}
      >
        <button>Edit Tags</button>
      </AlbumHeader>,
    );

    expect(screen.getByText("Edit Tags")).toBeInTheDocument();
    expect(screen.getByText("Download")).toBeInTheDocument();
    expect(screen.queryByText("Enrich")).not.toBeInTheDocument();
    expect(screen.queryByText("Lyrics")).not.toBeInTheDocument();
    expect(screen.queryByText("Metadata")).not.toBeInTheDocument();
  });

  it("keeps labeled album actions free of decorative glyphs", () => {
    renderHeader(
      <AlbumHeader
        {...baseProps}
        canEditArtwork={false}
        canEnrich
        canDownload
        canQueueMetadata
      />,
    );

    for (const label of [
      "Enrich",
      "Download",
      "Lyrics",
      "Metadata",
      "Export",
    ]) {
      const action =
        label === "Download"
          ? screen.getByRole("link", { name: label })
          : screen.getByRole("button", { name: label });
      expect(action.querySelector("svg")).toBeNull();
    }
  });
});
