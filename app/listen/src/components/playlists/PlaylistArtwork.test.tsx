import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlaylistArtwork } from "./PlaylistArtwork";

describe("PlaylistArtwork", () => {
  it("uses global album artwork when playlist tracks only have global refs", () => {
    const { container } = render(
      <PlaylistArtwork
        name="Remote set"
        tracks={[
          {
            artist: "High Vis",
            album: "Blending",
            global_album_uid: "global-blending",
          },
        ]}
        className="h-24 w-24"
      />,
    );

    const img = container.querySelector("img[alt='Remote set']");

    expect(img).toBeInTheDocument();
    expect(img?.getAttribute("src")).toContain(
      "/api/catalog/albums/global-blending/cover",
    );
  });
});
