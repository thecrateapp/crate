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
  expect(screen.getByTestId("loading-state")).toBeInTheDocument();
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
