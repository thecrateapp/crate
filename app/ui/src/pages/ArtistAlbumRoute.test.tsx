import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { ArtistAlbumRoute } from "./ArtistAlbumRoute";

function renderArtistOrAlbum(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/artists/:artistSlug/:albumSlug"
          element={
            <ArtistAlbumRoute
              artist={<h1>Artist detail</h1>}
              album={<h1>Album detail</h1>}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ArtistAlbumRoute", () => {
  it("resolves the legacy numeric artist-ID URL to Artist", () => {
    renderArtistOrAlbum("/artists/42/the-clash");

    expect(
      screen.getByRole("heading", { name: "Artist detail" }),
    ).toBeInTheDocument();
  });

  it("keeps the canonical artist/album slug URL on Album", () => {
    renderArtistOrAlbum("/artists/the-clash/london-calling");

    expect(
      screen.getByRole("heading", { name: "Album detail" }),
    ).toBeInTheDocument();
  });
});
