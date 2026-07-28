import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/i18n";

import {
  ArtistAlbumsSection,
  ArtistAppearsOnSection,
  RelatedArtistsSection,
} from "./ArtistPageSections";

vi.mock("@/components/cards/AlbumCard", () => ({
  AlbumCard: ({ album }: { album: string }) => <div>{album}</div>,
}));

vi.mock("@/components/cards/ArtistCard", () => ({
  ArtistCard: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("@/components/playlists/PlaylistCard", () => ({
  PlaylistCard: ({ name }: { name: string }) => <div>{name}</div>,
}));

describe("ArtistPageSections", () => {
  it("uses authenticated responsive artwork for global album cards", () => {
    render(
      <MemoryRouter>
        <I18nProvider initialLocale="en">
          <ArtistAlbumsSection
            artistName="Pearl Jam"
            artistSlug="pearl-jam"
            albums={[
              {
                id: "global-album-1",
                entity_uid: "11111111-1111-4111-8111-111111111111",
                global_album_uid: "global-album-1",
                name: "Ten",
                display_name: "Ten",
                slug: "ten",
                year: "1991",
                tracks: 11,
                formats: ["FLAC"],
                size_mb: 420,
                has_cover: true,
              },
            ]}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    const artwork = screen.getByRole("img", { name: "Ten" });
    expect(artwork.tagName).toBe("IMG");
    expect(artwork).toHaveAttribute("sizes");
    expect(artwork.getAttribute("srcset")).toContain("size=320");
  });

  it("uses the API-provided canonical artist slug for album links", () => {
    render(
      <MemoryRouter>
        <I18nProvider initialLocale="en">
          <ArtistAlbumsSection
            artistName="Derby Motoreta’s Burrito Kachimba"
            artistSlug="derby-motoretas-burrito-kachimba"
            albums={[
              {
                id: "54561c2a-89ab-566d-a30d-3b9ad10ea576",
                global_album_uid: "54561c2a-89ab-566d-a30d-3b9ad10ea576",
                name: "Bolsa Amarilla y Piedra Potente",
                display_name: "Bolsa Amarilla y Piedra Potente",
                slug: "bolsa-amarilla-y-piedra-potente",
                year: "2024",
                tracks: 12,
                formats: ["FLAC"],
                size_mb: 420,
                has_cover: true,
              },
            ]}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", { name: /Bolsa Amarilla y Piedra Potente/i }),
    ).toHaveAttribute(
      "href",
      "/artists/derby-motoretas-burrito-kachimba/bolsa-amarilla-y-piedra-potente",
    );
  });

  it("localizes artist rail headings", () => {
    render(
      <MemoryRouter>
        <I18nProvider initialLocale="es">
          <ArtistAlbumsSection
            artistName="Crossed"
            albums={[
              {
                id: 1,
                name: "MORIR",
                display_name: "MORIR",
                slug: "morir",
                year: "2022",
                tracks: 1,
                formats: ["FLAC"],
                size_mb: 42,
                has_cover: false,
                release_category: "album",
              },
            ]}
          />
          <ArtistAppearsOnSection
            playlists={[
              {
                id: 2,
                name: "Hardcore",
                track_count: 3,
                artist_track_count: 1,
              },
            ]}
          />
          <RelatedArtistsSection
            artists={[{ name: "Tenue", match: 0.85, id: 3, slug: "tenue" }]}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: "Álbumes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Aparece en" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Artistas relacionados" }),
    ).toBeInTheDocument();
  });

  it("groups albums, EPs, compilations, live albums, and other releases", () => {
    render(
      <MemoryRouter>
        <I18nProvider initialLocale="en">
          <ArtistAlbumsSection
            artistName="Pantera"
            albums={[
              {
                id: 1,
                name: "Vulgar Display of Power",
                display_name: "Vulgar Display of Power",
                year: "1992",
                tracks: 11,
                formats: ["FLAC"],
                size_mb: 500,
                has_cover: true,
                release_category: "album",
              },
              {
                id: 2,
                name: "Walk EP",
                display_name: "Walk EP",
                year: "1993",
                tracks: 4,
                formats: ["FLAC"],
                size_mb: 150,
                has_cover: true,
                release_category: "ep_single",
              },
              {
                id: 3,
                name: "The Best of Pantera",
                display_name: "The Best of Pantera",
                year: "2003",
                tracks: 16,
                formats: ["FLAC"],
                size_mb: 700,
                has_cover: true,
                release_category: "compilation",
              },
              {
                id: 4,
                name: "Live at Dynamo Open Air 1998",
                display_name: "Live at Dynamo Open Air 1998",
                year: "1998",
                tracks: 14,
                formats: ["FLAC"],
                size_mb: 800,
                has_cover: true,
              },
              {
                id: 5,
                name: "Hostile Remixes",
                display_name: "Hostile Remixes",
                year: "1994",
                tracks: 6,
                formats: ["FLAC"],
                size_mb: 250,
                has_cover: true,
                release_type: "Album",
                release_secondary_types: ["DJ-mix"],
              },
            ]}
          />
        </I18nProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Albums" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "EPs & Singles" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Compilations" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Live Albums" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Other Releases" }),
    ).toBeInTheDocument();
  });
});
