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
});
