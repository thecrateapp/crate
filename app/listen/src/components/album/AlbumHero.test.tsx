import { createRef } from "react";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Button } from "@crate/ui/shadcn/button";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { AlbumHero } from "./AlbumHero";
import type { AlbumData } from "@/pages/album-types";

const data: AlbumData = {
  artist: "Costa Norte",
  name: "Luz de octubre",
  display_name: "Luz de octubre",
  path: "Costa Norte/Luz de octubre",
  track_count: 0,
  total_size_mb: 0,
  total_length_sec: 0,
  has_cover: false,
  cover_file: null,
  tracks: [],
  album_tags: {
    artist: "Costa Norte",
    album: "Luz de octubre",
    year: "2026",
    genre: "Ambient",
    musicbrainz_albumid: null,
  },
  genres: [],
};
it("keeps the real album identity, artist navigation and injected actions through the shared hero", async () => {
  const artist = vi.fn();
  const play = vi.fn();
  renderWithListenProviders(
    <AlbumHero
      data={data}
      coverUrl=""
      artistPhotoUrl=""
      displayName={data.display_name}
      isPreRelease={false}
      canPersistAlbum={false}
      offlineState="idle"
      year="2026"
      playerTrackCount={0}
      qualityBadges={[
        {
          label: "FLAC 16/44.1",
          tier: "lossless",
          detail: "16-bit / 44.1 kHz",
        },
      ]}
      visibleContributor={null}
      primaryContributorName={null}
      primaryContributorPath={null}
      primaryContributorSource={null}
      albumHeroInfoRef={createRef()}
      actions={<Button onClick={play}>Play album</Button>}
      onArtistNavigate={artist}
      onGenreSelect={() => {}}
      t={(key) => key}
    />,
  );
  expect(
    screen.getByRole("region", { name: "Luz de octubre" }),
  ).toContainElement(
    screen.getByRole("heading", { level: 1, name: "Luz de octubre" }),
  );
  expect(screen.getByText("2026")).toBeVisible();
  const quality = screen
    .getByText("FLAC 16/44.1")
    .closest('[data-slot="info-badge"]');
  expect(quality).toHaveAttribute("data-quality-tier", "lossless");
  expect(quality?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(
    screen
      .getByRole("button", { name: "Costa Norte" })
      .querySelector('[data-slot="avatar"]'),
  ).toHaveAttribute("data-size", "xs");
  await userEvent.click(screen.getByRole("button", { name: "Costa Norte" }));
  expect(artist).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "Play album" }));
  expect(play).toHaveBeenCalledOnce();
});
