import { fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const coverflowMounts = vi.hoisted(() => ({ count: 0 }));

vi.mock("@ashishgogula/coverflow", () => ({
  CoverFlow: function MockCoverFlow({
    items,
    initialIndex,
    enableScroll,
    enableClickToSnap,
    onIndexChange,
    renderImage,
  }: {
    items: Array<{ id: string; title: string; image: string }>;
    initialIndex?: number;
    enableScroll?: boolean;
    enableClickToSnap?: boolean;
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
  }) {
    const [instance] = useState(() => {
      coverflowMounts.count += 1;
      return coverflowMounts.count;
    });
    const active = items[initialIndex ?? 0];
    return (
      <div
        role="region"
        aria-label="Cover Flow"
        data-testid="coverflow"
        data-instance={instance}
        data-initial-index={initialIndex}
        data-item-count={items.length}
        data-scroll-enabled={enableScroll}
        data-click-to-snap={enableClickToSnap}
      >
        {renderImage?.({
          src: active?.image ?? "",
          alt: active?.title ?? "",
          width: 280,
          height: 280,
          className: "cover",
          draggable: false,
          sizes: "280px",
        })}
        <button
          type="button"
          onClick={() => onIndexChange?.((initialIndex ?? 0) + 1)}
        >
          Mock coverflow next
        </button>
        <button type="button" onClick={() => onIndexChange?.(0)}>
          Mock coverflow first
        </button>
      </div>
    );
  },
}));

import { CrateCoverFlow } from "@/components/crates/CrateCoverFlow";
import { orderCrateAlbums } from "@/components/crates/crate-model";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const rawAlbums = [
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
    position: 3,
    name: "Second record",
    artist_name: "Other artist",
    year: "2025",
    has_cover: false,
  },
];

function albums(isOrdered = true, direction: "asc" | "desc" = "asc") {
  return orderCrateAlbums(rawAlbums, isOrdered, direction);
}

describe("CrateCoverFlow", () => {
  beforeEach(() => {
    coverflowMounts.count = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  it("keeps swipe navigation and renders the caption below the flow", () => {
    renderWithListenProviders(
      <CrateCoverFlow albums={albums()} isOrdered crateName="Year-end" />,
      { locale: "en" },
    );

    const coverflow = screen.getByTestId("coverflow");
    expect(coverflow).toBeVisible();
    expect(coverflow).toHaveAttribute("data-scroll-enabled", "true");
    expect(coverflow).toHaveAttribute("data-click-to-snap", "true");
    expect(coverflow).toHaveAttribute("aria-label", "Covers in Year-end");
    expect(screen.getByText("Rank #1")).toBeVisible();
    expect(screen.getByTestId("crate-coverflow-frame")).not.toContainElement(
      screen.getByText("First record"),
    );
    expect(screen.getByText("Album 1 of 2:").parentElement).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(
      screen.queryByRole("button", { name: "Previous album" }),
    ).not.toBeInTheDocument();
  });

  it("does not show ranking overlays for unordered Crates", () => {
    renderWithListenProviders(
      <CrateCoverFlow
        albums={albums(false)}
        isOrdered={false}
        crateName="Year-end"
      />,
      { locale: "en" },
    );

    expect(screen.queryByText("Rank #1")).not.toBeInTheDocument();
  });

  it("numbers descending Crates from the highest rank without gaps", () => {
    renderWithListenProviders(
      <CrateCoverFlow
        albums={albums(true, "desc")}
        isOrdered
        crateName="Year-end"
      />,
      { locale: "en" },
    );

    expect(screen.getByText("Rank #2")).toBeVisible();
    expect(screen.getByText("02")).toBeVisible();
    expect(screen.getByText("Second record")).toBeVisible();
  });

  it("moves through albums without remounting the coverflow", () => {
    renderWithListenProviders(
      <CrateCoverFlow albums={albums()} isOrdered crateName="Year-end" />,
      { locale: "en" },
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Mock coverflow next" }),
    );

    const coverflow = screen.getByTestId("coverflow");
    expect(coverflow).toHaveAttribute("data-initial-index", "1");
    expect(coverflow).toHaveAttribute("data-instance", "1");
    expect(screen.getByText("Second record")).toBeVisible();
  });

  it("recenters looping Crates at the edges without remounting", () => {
    renderWithListenProviders(
      <CrateCoverFlow
        albums={albums()}
        isOrdered
        loopEnabled
        crateName="Year-end"
      />,
      { locale: "en" },
    );

    const coverflow = screen.getByTestId("coverflow");
    expect(coverflow).toHaveAttribute("data-item-count", "6");
    expect(coverflow).toHaveAttribute("data-initial-index", "2");

    fireEvent.click(
      screen.getByRole("button", { name: "Mock coverflow first" }),
    );

    expect(screen.getByTestId("coverflow")).toHaveAttribute(
      "data-initial-index",
      "2",
    );
    expect(screen.getByTestId("coverflow")).toHaveAttribute(
      "data-instance",
      "1",
    );
  });
});
