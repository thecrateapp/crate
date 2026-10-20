import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { CatalogSearch } from "./CatalogSearch";
const items = [
  {
    kind: "track" as const,
    key: "track:one",
    title: "Talk For Hours",
    subtitle: "High Vis · Blending",
    imageUrl: "/cover-track.jpg",
    data: { id: "track" },
  },
  {
    kind: "album" as const,
    key: "album:one",
    title: "Blending",
    subtitle: "High Vis",
    imageUrl: "/cover-album.jpg",
    data: { id: "album" },
  },
  {
    kind: "artist" as const,
    key: "artist:one",
    title: "High Vis",
    imageUrl: "/photo.jpg",
    data: { id: "artist" },
  },
];
it("limits results to one or several domain kinds, preserves covers and selects original data", () => {
  const onSelect = vi.fn();
  const { rerender } = renderWithListenProviders(
    <CatalogSearch
      label="Catalog search"
      query="high"
      onQueryChange={vi.fn()}
      items={items}
      kinds={["track", "artist"]}
      searching={false}
      onSelect={onSelect}
    />,
  );
  expect(screen.queryByRole("button", { name: "Blending" })).toBeNull();
  const track = screen.getByRole("button", { name: "Talk For Hours" });
  expect(track.querySelector("img")).toHaveAttribute("src", "/cover-track.jpg");
  fireEvent.click(track);
  expect(onSelect).toHaveBeenCalledWith(items[0]);
  expect(
    screen
      .getByRole("button", { name: "High Vis" })
      .querySelector('[data-slot="media-cover"]'),
  ).toHaveClass("rounded-full");
  rerender(
    <CatalogSearch
      label="Catalog search"
      query="high"
      onQueryChange={vi.fn()}
      items={items}
      kinds={["album"]}
      searching={false}
      onSelect={onSelect}
    />,
  );
  expect(screen.queryByRole("button", { name: "Talk For Hours" })).toBeNull();
  expect(screen.getByRole("button", { name: "Blending" })).toBeInTheDocument();
});
it("distinguishes loading, failed reads with retry and a true empty result", () => {
  const retry = vi.fn();
  const { rerender } = renderWithListenProviders(
    <CatalogSearch
      label="Catalog search"
      query="high"
      onQueryChange={vi.fn()}
      items={[]}
      searching
      onRetry={retry}
    />,
  );
  expect(
    screen.getByRole("status", { name: "Finding your music..." }),
  ).toBeInTheDocument();
  expect(screen.queryByTestId("empty-state")).toBeNull();
  rerender(
    <CatalogSearch
      label="Catalog search"
      query="high"
      onQueryChange={vi.fn()}
      items={[]}
      searching={false}
      error="Search failed"
      onRetry={retry}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retry).toHaveBeenCalledOnce();
  rerender(
    <CatalogSearch
      label="Catalog search"
      query="high"
      onQueryChange={vi.fn()}
      items={[]}
      searching={false}
    />,
  );
  expect(screen.getByTestId("empty-state")).toBeInTheDocument();
});

it("supports a genre alongside artist/album kinds and disables selection while an action is pending", () => {
  const onSelect = vi.fn();
  renderWithListenProviders(
    <CatalogSearch
      label="Seed"
      query="punk"
      onQueryChange={vi.fn()}
      searching={false}
      disabled
      kinds={["genre", "artist"]}
      items={[
        {
          key: "genre:punk",
          kind: "genre",
          title: "Punk",
          data: { id: "punk" },
        },
      ]}
      onSelect={onSelect}
    />,
  );
  expect(screen.getByRole("searchbox")).toBeDisabled();
  const genre = screen.getByRole("button", { name: "Punk" });
  expect(genre).toBeDisabled();
  fireEvent.click(genre);
  expect(onSelect).not.toHaveBeenCalled();
});

it.each([
  { kinds: ["album"] as const, label: "Finding albums..." },
  { kinds: ["artist"] as const, label: "Finding artists..." },
  { kinds: ["track"] as const, label: "Finding tracks..." },
  { kinds: ["genre"] as const, label: "Finding genres..." },
  { kinds: ["track", "album"] as const, label: "Finding your music..." },
])(
  "names the pending $kinds search and retains previous results",
  ({ kinds, label }) => {
    renderWithListenProviders(
      <CatalogSearch
        label="Catalog search"
        query="high"
        onQueryChange={vi.fn()}
        items={items}
        kinds={kinds}
        searching
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole("status", { name: label })).toBeInTheDocument();
    if (kinds.includes("track" as never))
      expect(
        screen.getByRole("button", { name: "Talk For Hours" }),
      ).toBeInTheDocument();
  },
);
