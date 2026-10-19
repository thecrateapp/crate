import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AlbumCardArtwork } from "./AlbumCardParts";
import { artworkFromUrl } from "@/lib/artwork-source";

describe("AlbumCardArtwork shared frame with real managed transport", () => {
  it("uses the shared frame without replacing managed load, responsive source or fallback visibility", async () => {
    const source = artworkFromUrl("/covers/one.jpg", {
      logicalKey: "album:one",
      srcSet: "/covers/small.jpg 160w, /covers/one.jpg 320w",
    });
    const view = render(
      <AlbumCardArtwork
        album="Costa Norte"
        coverArtwork={source}
        coverSizes="50vw"
        className="size-32"
      />,
    );
    expect(view.container.firstElementChild).toHaveAttribute(
      "data-slot",
      "media-cover",
    );
    expect(
      view.container.querySelectorAll('[data-slot="media-cover"]'),
    ).toHaveLength(1);
    const image = screen.getByRole("img", { name: "Costa Norte" });
    expect(image).toHaveAttribute("data-artwork-managed", "true");
    expect(image).toHaveAttribute(
      "srcset",
      "/covers/small.jpg 160w, /covers/one.jpg 320w",
    );
    expect(image).toHaveAttribute("sizes", "50vw");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(screen.getByTestId("artwork-fallback")).toHaveClass("opacity-100");
    fireEvent.load(image);
    await waitFor(() =>
      expect(screen.getByTestId("artwork-fallback")).toHaveClass("opacity-0"),
    );
    view.rerender(
      <AlbumCardArtwork
        album="Costa Norte"
        coverArtwork={{ ...source }}
        coverSizes="100vw"
        className="size-32"
      />,
    );
    expect(screen.getByRole("img", { name: "Costa Norte" })).toBe(image);
    expect(image).toHaveAttribute("sizes", "100vw");
    expect(screen.getByTestId("artwork-fallback")).toHaveClass("opacity-0");
  });
});
