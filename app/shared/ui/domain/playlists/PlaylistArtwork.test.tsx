import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlaylistArtwork } from "./PlaylistArtwork";
describe("PlaylistArtwork optional decorative fallback", () => {
  it("retains the default fallback glyph and deterministic gradient for existing consumers", () => {
    const { container } = render(
      <PlaylistArtwork name="Same set" buildCoverUrl={() => null} />,
    );
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect(container.firstElementChild).toHaveClass(
      "playlist-artwork-placeholder",
    );
  });
  it("can omit only the fallback glyph while retaining gradient and Crate mark", () => {
    const { container, rerender } = render(
      <PlaylistArtwork
        name="Same set"
        showCrateMark
        buildCoverUrl={() => null}
      />,
    );
    const style = container.firstElementChild!.getAttribute("style");
    rerender(
      <PlaylistArtwork
        name="Same set"
        showCrateMark
        showFallbackIcon={false}
        buildCoverUrl={() => null}
      />,
    );
    expect(container.querySelector("svg")).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass(
      "playlist-artwork-placeholder",
    );
    expect(container.firstElementChild!.getAttribute("style")).toBe(style);
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/icons/logo.svg",
    );
  });
  it("preserves supplied covers, collage sources and image-renderer transport independently of fallback visibility", () => {
    const image = vi.fn((props: React.ImgHTMLAttributes<HTMLImageElement>) => (
      <img {...props} />
    ));
    const build = vi.fn((track: { album_id?: number }) =>
      track.album_id ? `/sample/${track.album_id}` : null,
    );
    const { container, rerender } = render(
      <PlaylistArtwork
        name="Cover"
        coverDataUrl="data:image/png;base64,AA=="
        showFallbackIcon={false}
        buildCoverUrl={build}
        renderImage={image}
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "data:image/png;base64,AA==",
    );
    rerender(
      <PlaylistArtwork
        name="Collage"
        tracks={[{ album_id: 1 }, { album_id: 2 }]}
        showFallbackIcon={false}
        buildCoverUrl={build}
        renderImage={image}
      />,
    );
    expect(
      Array.from(container.querySelectorAll("img")).map((i) =>
        i.getAttribute("src"),
      ),
    ).toEqual(["/sample/1", "/sample/2"]);
    expect(image).toHaveBeenCalled();
  });
});

it("names a collage and a placeholder without exposing decorative tile names", () => {
  const view = render(
    <PlaylistArtwork
      name="Night tide"
      tracks={[{ album_id: 1 }, { album_id: 2 }]}
      buildCoverUrl={(track) => `/cover/${track.album_id}`}
      id="playlist-cover"
    />,
  );
  expect(view.getByRole("img", { name: "Night tide" })).toHaveAttribute(
    "id",
    "playlist-cover",
  );
  expect(view.getAllByRole("img")).toHaveLength(1);
  view.rerender(
    <PlaylistArtwork name="Night tide" buildCoverUrl={() => null} />,
  );
  expect(view.getByRole("img", { name: "Night tide" })).toBeInTheDocument();
});

it("falls back from a failed native cover to unique collage sources and then the generated artwork", () => {
  const view = render(
    <PlaylistArtwork
      name="Night tide"
      coverDataUrl="bad.jpg"
      tracks={[{ album_id: 1 }, { album_id: 1 }]}
      buildCoverUrl={(track) => `/cover/${track.album_id}`}
    />,
  );
  fireEvent.error(view.container.querySelector('img[alt="Night tide"]')!);
  expect(view.container.querySelector('img[alt="Night tide"]')).toHaveAttribute(
    "src",
    "/cover/1",
  );
  fireEvent.error(view.container.querySelector('img[alt="Night tide"]')!);
  expect(view.container.querySelector('img[alt="Night tide"]')).toBeNull();
  expect(view.getByRole("img", { name: "Night tide" })).toHaveClass(
    "playlist-artwork-placeholder",
  );
});
