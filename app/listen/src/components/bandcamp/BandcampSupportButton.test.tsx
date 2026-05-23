import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BandcampSupportButton } from "@/components/bandcamp/BandcampSupportButton";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
}));

const mockApi = vi.mocked(api);

describe("BandcampSupportButton", () => {
  it("shows an owned badge instead of a buy CTA for purchased albums", async () => {
    mockApi.mockResolvedValueOnce({
      entity_type: "album",
      entity_uid: "album-1",
      album_url: "https://artist.bandcamp.com/album/lp",
      user_owned: true,
      user_downloadable: true,
      latest_import_status: "completed",
    });

    render(<BandcampSupportButton entityType="album" entityUid="album-1" />);

    expect(await screen.findByText("Owned on Bandcamp")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /buy this album/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the import CTA for owned downloadable albums that are not imported", async () => {
    mockApi.mockResolvedValueOnce({
      entity_type: "album",
      entity_uid: "album-2",
      bandcamp_item_id: 42,
      album_url: "https://artist.bandcamp.com/album/lp",
      user_owned: true,
      user_downloadable: true,
      latest_import_status: null,
    });

    render(<BandcampSupportButton entityType="album" entityUid="album-2" />);

    expect(await screen.findByText("Import from Bandcamp")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /import from bandcamp/i }),
    ).toBeInTheDocument();
  });

  it("shows the buy CTA for albums that are not owned by the user", async () => {
    mockApi.mockResolvedValueOnce({
      entity_type: "album",
      entity_uid: "album-3",
      album_url: "https://artist.bandcamp.com/album/lp",
      user_owned: false,
      user_downloadable: false,
      latest_import_status: null,
    });

    render(<BandcampSupportButton entityType="album" entityUid="album-3" />);

    expect(
      await screen.findByText("Buy this album on Bandcamp"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /buy this album on bandcamp/i }),
    ).toBeInTheDocument();
  });
});
