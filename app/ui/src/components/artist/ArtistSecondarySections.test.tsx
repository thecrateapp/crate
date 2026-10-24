import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArtistOverviewSection } from "./ArtistOverviewSection";
import { ArtistAvatar } from "./ArtistAvatar";
import { ArtistDiscographySection } from "./ArtistDiscographySection";
import { ArtistShowsSection, type ArtistShowEvent } from "./ArtistShowsSection";
import { ArtistSimilarSection } from "./ArtistSimilarSection";
import { ArtistStatsSection } from "./ArtistStatsSection";
import { ArtistTopTracksSection } from "./ArtistTopTracksSection";
import { ArtistSetlistSection } from "./ArtistSetlistSection";
import { SimilarArtistCard, StatCard } from "./ArtistPageBits";

vi.mock("./ArtistBioResearchAction", () => ({
  ArtistBioResearchAction: ({ onClick }: { onClick: () => void }) => (
    <button onClick={onClick}>Research with AI</button>
  ),
}));
vi.mock("@/components/ui/music-context-menu", () => ({
  MusicContextMenu: ({
    children,
    trackId,
  }: {
    children: ReactNode;
    trackId: string;
  }) => <div data-testid={`track-menu-${trackId}`}>{children}</div>,
}));
vi.mock("./ArtistNetworkGraph", () => ({
  ArtistNetworkGraph: () => <div>Network instrument</div>,
}));
const { statsProps } = vi.hoisted(() => ({ statsProps: vi.fn() }));
vi.mock("./ArtistStats", () => ({
  ArtistStats: (props: Record<string, unknown>) => {
    statsProps(props);
    return <div>Artist statistics</div>;
  },
}));
vi.mock("@/components/album/AlbumCard", () => ({
  AlbumCard: ({ name }: { name: string }) => <div>{name}</div>,
}));
vi.mock("@/components/album/MissingAlbumCard", () => ({
  MissingAlbumCard: ({ title }: { title: string }) => <div>{title}</div>,
}));
vi.mock("@/components/album/TidalAlbumCard", () => ({
  TidalAlbumCard: ({ title }: { title: string }) => <div>{title}</div>,
}));

function frame(children: ReactNode) {
  return render(<MemoryRouter>{children}</MemoryRouter>);
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

describe("artist secondary presentation contracts", () => {
  it.each([
    ["Overview", "Biography"],
    ["Top Tracks", "Top Tracks"],
    ["Discography", "Albums"],
    ["Setlist", "Probable Setlist"],
    ["Shows", "Upcoming Shows"],
    ["Similar", "Artist Network"],
    ["Stats", "Stats"],
  ])(
    "keeps the first %s section in the shared artist tab frame",
    (tab, heading) => {
      const content: Record<string, ReactNode> = {
        Overview: (
          <ArtistOverviewSection
            bioText="Artist biography"
            bioExpanded={false}
            onToggleBioExpanded={vi.fn()}
            topTracks={[]}
            externalLinks={[]}
            albumCount={0}
            totalTracks={0}
            totalSizeMb={0}
            enrichmentLoading={false}
          />
        ),
        "Top Tracks": <ArtistTopTracksSection topTracks={[]} />,
        Discography: (
          <ArtistDiscographySection
            artistName="Artist"
            albums={[]}
            sortedAlbums={[]}
            missingAlbums={[]}
            tidalMissing={[]}
            showMissing={false}
            sort="name"
            downloadingDiscog={false}
            onToggleShowMissing={vi.fn()}
            onSortChange={vi.fn()}
            onDownloadDiscography={vi.fn()}
          />
        ),
        Setlist: (
          <ArtistSetlistSection
            artistName="Artist"
            allTrackTitles={[]}
            onTrackTitlesLoaded={vi.fn()}
          />
        ),
        Shows: <ArtistShowsSection artistName="Artist" shows={[]} />,
        Similar: <ArtistSimilarSection artistName="Artist" artists={[]} />,
        Stats: <ArtistStatsSection artistName="Artist" />,
      };
      const { container } = frame(content[tab]);
      const firstSection = container.querySelector(
        '[data-slot="artist-detail-section"]',
      );
      expect(firstSection).toContainElement(
        screen.getByRole("heading", { name: heading }),
      );
      expect(firstSection).not.toHaveClass("border-t", "pt-5.5");
      expect(
        firstSection?.querySelector('[data-slot="artist-detail-header"]'),
      ).toHaveClass("min-h-11", "mb-3", "items-center");
      expect(
        firstSection?.querySelector('[data-slot="artist-detail-body"]'),
      ).toBeTruthy();
    },
  );

  it.each(["Biography", "Top Tracks", "Stats"])(
    "leaves %s unruled when it is the first visible Overview panel",
    (firstPanel) => {
      const panels = ["Biography", "Top Tracks", "Stats"];
      const first = panels.indexOf(firstPanel);
      frame(
        <ArtistOverviewSection
          bioText={first === 0 ? "Artist biography" : ""}
          bioExpanded={false}
          onToggleBioExpanded={vi.fn()}
          topTracks={
            first <= 1
              ? [
                  {
                    id: "1",
                    track: 1,
                    title: "Song",
                    artist: "Artist",
                    album: "Album",
                    album_id: 2,
                    duration: 90,
                  },
                ]
              : []
          }
          albumCount={2}
          totalTracks={12}
          totalSizeMb={100}
          lastfm={first <= 2 ? { listeners: 10 } : undefined}
          externalLinks={[
            { label: "Website", url: "https://artist.example", color: "" },
          ]}
          enrichmentLoading={false}
        />,
      );
      for (const [index, name] of panels.slice(first).entries()) {
        const panel = screen.getByRole("heading", { name }).closest("section");
        if (index === 0) expect(panel).not.toHaveClass("border-t");
        else expect(panel).toHaveClass("border-t");
      }
    },
  );

  it("keeps real zero stats, biography disclosure and external destinations", async () => {
    const onToggle = vi.fn();
    frame(
      <ArtistOverviewSection
        bioText={"Long biography. ".repeat(40)}
        bioExpanded={false}
        onToggleBioExpanded={onToggle}
        topTracks={[]}
        albumCount={2}
        totalTracks={12}
        totalSizeMb={100}
        lastfm={{ listeners: 0, playcount: 0 }}
        spotify={{ followers: 0, popularity: 0 }}
        externalLinks={[
          {
            label: "Bandcamp",
            url: "https://artist.bandcamp.com",
            color: "unused-provider-color",
          },
        ]}
        enrichmentLoading={false}
      />,
    );
    expect(screen.getAllByText("0")).toHaveLength(3);
    expect(screen.getByText("0%")).toBeInTheDocument();
    const disclosure = screen.getByRole("button", { name: "More" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(disclosure);
    expect(onToggle).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Bandcamp" })).toHaveAttribute(
      "href",
      "https://artist.bandcamp.com",
    );
    expect(screen.getByRole("heading", { name: "Biography" })).toHaveClass(
      "crate-mono-label",
      "text-accent-action-hi",
    );
  });

  it("consolidates formation, members, audience and library data in Overview without duplicates", async () => {
    const onResearchBio = vi.fn();
    frame(
      <ArtistOverviewSection
        bioText="Artist biography"
        bioExpanded={false}
        onToggleBioExpanded={vi.fn()}
        topTracks={[]}
        musicbrainz={{
          type: "Group",
          country: "CA",
          area: "Toronto",
          begin_date: "1990",
          end_date: "2020",
          members: [
            { name: "One Member", begin: "1990", attributes: ["guitar"] },
            {
              name: "Former Member",
              begin: "1991",
              end: "1999",
              attributes: ["bass"],
            },
          ],
        }}
        lastfm={{ listeners: 0, playcount: 0 }}
        spotify={{ followers: 0, popularity: 0 }}
        externalLinks={[
          { label: "Official", url: "https://artist.example", color: "" },
        ]}
        albumCount={2}
        totalTracks={12}
        totalSizeMb={100}
        enrichmentLoading={false}
        canResearchBio
        onResearchBio={onResearchBio}
      />,
    );
    expect(screen.getAllByRole("heading", { name: "Biography" })).toHaveLength(
      1,
    );
    expect(screen.getAllByRole("heading", { name: "Stats" })).toHaveLength(1);
    expect(screen.getAllByText("Artist biography")).toHaveLength(1);
    for (const label of [
      "Formed",
      "Country",
      "Area",
      "Listeners",
      "Followers",
      "Popularity",
      "Scrobbles",
    ]) {
      expect(screen.getAllByText(label)).toHaveLength(1);
    }
    expect(screen.getByText("One Member")).toBeInTheDocument();
    expect(screen.getByText("Former Member")).toBeInTheDocument();
    expect(screen.getByText("1990 – present")).toBeInTheDocument();
    expect(screen.getByText("1991 – 1999")).toBeInTheDocument();
    expect(screen.getByText("guitar")).toBeInTheDocument();
    expect(screen.getByText("bass")).toBeInTheDocument();
    const stats = screen.getByRole("region", { name: "Stats" });
    for (const value of [
      "Group",
      "CA",
      "Toronto",
      "1990",
      "2020",
      "1",
      "0%",
      "2 albums in library",
      "12 tracks",
    ]) {
      expect(within(stats).getByText(value)).toBeInTheDocument();
    }
    expect(within(stats).getAllByText("0")).toHaveLength(3);
    expect(screen.getAllByRole("link", { name: "Official" })).toHaveLength(1);
    expect(
      screen
        .getByRole("heading", { name: "Members" })
        .closest('[data-slot="artist-detail-section"]'),
    ).toHaveClass("border-t");
    await userEvent.click(
      screen.getByRole("button", { name: "Research with AI" }),
    );
    expect(onResearchBio).toHaveBeenCalledOnce();
  });

  it("keeps biography research reachable when the artist has no biography yet", async () => {
    const onResearchBio = vi.fn();
    frame(
      <ArtistOverviewSection
        bioText=""
        bioExpanded={false}
        onToggleBioExpanded={vi.fn()}
        topTracks={[]}
        externalLinks={[]}
        albumCount={0}
        totalTracks={0}
        totalSizeMb={0}
        enrichmentLoading={false}
        canResearchBio
        onResearchBio={onResearchBio}
      />,
    );
    expect(screen.getByText("No biography available.")).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Research with AI" }),
    );
    expect(onResearchBio).toHaveBeenCalledOnce();
  });

  it("keeps related-artist links native and artwork recoverable", () => {
    const { container } = frame(
      <>
        <SimilarArtistCard id={7} slug="local-artist" name="Local Artist" />
        <SimilarArtistCard name="Remote Artist" />
        <ArtistAvatar
          name="Local Artist"
          artistId={7}
          artistSlug="local-artist"
          linked
        />
      </>,
    );
    const local = screen.getAllByRole("link", { name: "Open Local Artist" });
    expect(local[0]).toHaveAttribute("href", "/artists/local-artist");
    expect(local[1]).toHaveAttribute("href", "/artists/local-artist");
    expect(
      screen.getByRole("link", { name: "Open Remote Artist" }),
    ).toHaveAttribute("target", "_blank");
    fireEvent.error(screen.getAllByRole("img", { name: "Local Artist" })[0]!);
    expect(
      within(local[0]!).getByTestId("media-cover-fallback"),
    ).toHaveAttribute("data-state", "fallback");
    expect(container.querySelector("[title]")).toBeNull();
  });

  it("renders statistics without decorative legacy icons", () => {
    const { container } = frame(
      <StatCard
        label="Listeners"
        value="200"
        icon={<svg data-testid="legacy-icon" />}
      />,
    );
    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.queryByTestId("legacy-icon")).toBeNull();
    expect(container.querySelector(".crate-mono-label")).toHaveTextContent(
      "Listeners",
    );
  });

  it("keeps ticket navigation, show metadata and on-sale state", () => {
    const show: ArtistShowEvent = {
      id: "show-1",
      name: "Festival",
      date: "2026-11-10",
      local_date: "2026-11-10",
      venue: "Main Hall",
      city: "Toronto",
      country: "Canada",
      region: "",
      country_code: "CA",
      url: "https://tickets.example/show",
      image: "",
      lineup: ["Local Artist", "Support Artist"],
      status: "onsale",
      price_range: { min: 20, max: 30, currency: "CAD" },
    };
    const { container } = frame(
      <ArtistShowsSection
        artistName="Local Artist"
        artistId={7}
        shows={[show]}
      />,
    );
    expect(
      screen.getByRole("link", { name: "Open tickets for Festival" }),
    ).toHaveAttribute("href", show.url);
    expect(screen.getByText("On Sale")).toHaveAttribute(
      "data-slot",
      "info-badge",
    );
    expect(screen.getByText("with Support Artist")).toBeInTheDocument();
    expect(screen.getByText("20–30 CAD")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("preserves library track menus and deduplicates Spotify additions", () => {
    frame(
      <ArtistTopTracksSection
        topTracks={[
          {
            id: "1",
            track: 1,
            title: "Local Song",
            artist: "Artist",
            album: "Album",
            album_id: 2,
            duration: 90,
          },
        ]}
        spotifyTopTracks={[
          {
            name: "Local Song",
            album: "Album",
            duration_ms: 90000,
            popularity: 50,
          },
          {
            name: "Remote Song",
            album: "Other",
            duration_ms: 120000,
            popularity: 75,
          },
        ]}
      />,
    );
    expect(screen.getAllByText("Local Song")).toHaveLength(1);
    expect(
      within(screen.getByTestId("track-menu-1")).getByText("Local Song"),
    ).toBeInTheDocument();
    expect(screen.getByText("Remote Song")).toBeInTheDocument();
    expect(screen.getByText("Spotify")).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", { name: "Popularity" }),
    ).toHaveAttribute("aria-valuenow", "75");
  });

  it("preserves missing-release toggle, sort and Tidal capability", async () => {
    const onToggle = vi.fn();
    const onSort = vi.fn();
    const onDownload = vi.fn();
    const props = {
      artistName: "Artist",
      artistId: 7,
      albums: [],
      sortedAlbums: [],
      missingAlbums: [
        { title: "Missing", first_release_date: "2000", type: "Album" },
      ],
      tidalMissing: [
        {
          url: "https://tidal.example",
          title: "Tidal release",
          year: "2025",
          tracks: 10,
          cover: null,
          quality: "FLAC",
        },
      ],
      showMissing: false,
      sort: "name",
      downloadingDiscog: false,
      onToggleShowMissing: onToggle,
      onSortChange: onSort,
      onDownloadDiscography: onDownload,
    };
    const { rerender } = frame(<ArtistDiscographySection {...props} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Show missing (1)" }),
    );
    expect(onToggle).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: /Complete Discography/ }),
    ).toBeNull();
    await userEvent.click(
      screen.getByRole("combobox", { name: "Sort albums" }),
    );
    await userEvent.click(screen.getByRole("option", { name: "Newest" }));
    expect(onSort).toHaveBeenCalledWith("year");
    rerender(
      <MemoryRouter>
        <ArtistDiscographySection {...props} canDownloadTidal />
      </MemoryRouter>,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Complete Discography/ }),
    );
    expect(onDownload).toHaveBeenCalledOnce();
  });

  it("shows the shared empty state across the discography grid when no albums are available", () => {
    frame(
      <ArtistDiscographySection
        artistName="Artist"
        albums={[]}
        sortedAlbums={[]}
        missingAlbums={[]}
        tidalMissing={[]}
        showMissing={false}
        sort="name"
        downloadingDiscog={false}
        onToggleShowMissing={vi.fn()}
        onSortChange={vi.fn()}
        onDownloadDiscography={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("status", { name: "No albums in library" }),
    ).toHaveClass("col-span-full");
    expect(
      screen.getByText("Albums added to this artist will appear here."),
    ).toBeInTheDocument();
  });

  it("keeps the network in Similar and removes the duplicated Stats request", () => {
    frame(
      <>
        <ArtistSimilarSection artistName="Artist" artists={[]} />
        <ArtistStatsSection artistName="Artist" />
      </>,
    );
    expect(
      screen.getAllByRole("heading", { name: "Artist Network" }),
    ).toHaveLength(1);
    expect(screen.getAllByText("Network instrument")).toHaveLength(1);
    expect(
      within(screen.getByRole("region", { name: "Stats" })).getByText(
        "Artist statistics",
      ),
    ).toBeInTheDocument();
  });
});

it("forwards the existing album catalogue through the Stats section", () => {
  const albums = [
    {
      id: 44,
      entity_uid: "album-44",
      name: "Album",
      year: "2004",
      tracks: 4,
      formats: ["FLAC"],
      size_mb: 100,
      has_cover: true,
    },
  ];
  frame(
    <ArtistStatsSection
      artistName="Artist"
      artistId={7}
      catalogueAlbums={albums}
      totalTracks={20}
      genreProfile={[{ name: "Rock", weight: 0.8 }]}
    />,
  );
  expect(statsProps).toHaveBeenLastCalledWith(
    expect.objectContaining({
      catalogueAlbums: albums,
      artistId: 7,
      totalTracks: 20,
      genreProfile: [{ name: "Rock", weight: 0.8 }],
    }),
  );
});
