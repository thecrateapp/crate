import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ashishgogula/coverflow", () => ({
  CoverFlow: ({
    items,
    initialIndex,
    onIndexChange,
    renderImage,
  }: {
    items: Array<{ id: string; title: string; image: string }>;
    initialIndex?: number;
    onIndexChange?: (index: number) => void;
    renderImage?: (props: {
      src: string;
      alt: string;
      width: number;
      height: number;
      className: string;
      draggable: boolean;
      sizes: string;
    }) => React.ReactNode;
  }) => (
    <div data-testid="coverflow">
      {renderImage?.({
        src: items[0]?.image ?? "",
        alt: items[0]?.title ?? "",
        width: 280,
        height: 280,
        className: "cover",
        draggable: false,
        sizes: "280px",
      })}
      <button type="button" onClick={() => onIndexChange?.(1)}>
        Mock second slide
      </button>
      <button
        type="button"
        onClick={() => onIndexChange?.((initialIndex ?? 0) + 1)}
      >
        Mock coverflow next
      </button>
    </div>
  ),
}));

import { CrateCoverFlow } from "@/components/crates/CrateCoverFlow";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const albums = [
  {
    global_album_uid: "album-1",
    position: 0,
    name: "First record",
    artist_name: "Listener",
    year: "2026",
    has_cover: false,
  },
  {
    global_album_uid: "album-2",
    position: 1,
    name: "Second record",
    artist_name: "Listener",
    year: "2025",
    has_cover: false,
  },
];

describe("CrateCoverFlow", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  it("keeps album navigation and play controls outside the coverflow", () => {
    const onPlay = vi.fn();
    renderWithListenProviders(
      <CrateCoverFlow
        albums={albums}
        isOrdered
        sortDirection="asc"
        onPlay={onPlay}
      />,
      { locale: "en" },
    );

    expect(screen.getByTestId("coverflow")).toBeVisible();
    expect(screen.getByText("First record")).toBeVisible();
    expect(screen.getByText("Rank #1")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Next album" }));
    expect(screen.getByText("Second record")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Play crate" }));
    expect(onPlay).toHaveBeenCalledWith(albums[1]);
  });

  it("does not show ranking overlays for unordered Crates", () => {
    renderWithListenProviders(
      <CrateCoverFlow
        albums={albums}
        isOrdered={false}
        sortDirection="asc"
        onPlay={vi.fn()}
      />,
      { locale: "en" },
    );

    expect(screen.queryByText("Rank #1")).not.toBeInTheDocument();
  });

  it("starts descending ordered Crates on the highest position number", () => {
    renderWithListenProviders(
      <CrateCoverFlow
        albums={albums}
        isOrdered
        sortDirection="desc"
        onPlay={vi.fn()}
      />,
      { locale: "en" },
    );

    expect(screen.getByText("Second record")).toBeVisible();
    expect(screen.getByText("Rank #2")).toBeVisible();
    expect(screen.getByText("02")).toBeVisible();
  });

  it("wraps coverflow controls only when loop playback is enabled", () => {
    renderWithListenProviders(
      <CrateCoverFlow
        albums={albums}
        isOrdered
        sortDirection="asc"
        loopEnabled
        onPlay={vi.fn()}
      />,
      { locale: "en" },
    );

    fireEvent.click(screen.getByRole("button", { name: "Next album" }));
    fireEvent.click(screen.getByRole("button", { name: "Next album" }));

    expect(screen.getByText("First record")).toBeVisible();
  });

  it("wraps coverflow navigation at the end when loop is enabled", () => {
    renderWithListenProviders(
      <CrateCoverFlow
        albums={albums}
        isOrdered
        sortDirection="asc"
        loopEnabled
        onPlay={vi.fn()}
      />,
      { locale: "en" },
    );

    fireEvent.click(screen.getByRole("button", { name: "Next album" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Mock coverflow next" }),
    );

    expect(screen.getByText("First record")).toBeVisible();
  });
});
