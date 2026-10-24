import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ArtistHeroSection } from "./ArtistHeroSection";

vi.mock("@/components/ImageCropUpload", () => ({
  ImageCropUpload: ({
    label,
    endpoint,
    className,
  }: {
    label: string;
    endpoint: string;
    className?: string;
  }) => (
    <button data-endpoint={endpoint} className={className}>
      {label}
    </button>
  ),
}));
function props() {
  return {
    artistName: "Converge",
    artistId: 7,
    letter: "C",
    albumCount: 3,
    totalTracks: 20,
    totalSizeMb: 100,
    popularityScore: 72,
    tags: ["hardcore"],
    enriching: false,
    isAdmin: true,
    photoLoaded: true,
    photoError: false,
    photoCacheBust: "",
    bgCacheBust: "",
    bgLoaded: true,
    showRepairAction: true,
    issueCount: 2,
    musicbrainz: {
      area: "Boston",
      country: "US",
      begin_date: "1990",
      type: "Group",
    },
    lastfmListeners: 15000,
    onBackgroundLoad: vi.fn(),
    onPhotoLoad: vi.fn(),
    onPhotoError: vi.fn(),
    onBackgroundUploaded: vi.fn(),
    onPhotoUploaded: vi.fn(),
    onEnrich: vi.fn(),
    onAnalyze: vi.fn(),
    onEditMetadata: vi.fn(),
    onCreateCorePlaylist: vi.fn(),
    onSyncLyrics: vi.fn(),
    onWritePortableMetadata: vi.fn(),
    onExportRichMetadata: vi.fn(),
    onRepair: vi.fn(),
    onMerge: vi.fn(),
    onDelete: vi.fn(),
  };
}
describe("ArtistHeroSection", () => {
  it("uses the shared hero and preserves every capability-gated action as an accessible icon control", async () => {
    const model = props();
    const { container } = render(
      <MemoryRouter>
        <ArtistHeroSection {...model} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("page-hero")).toHaveAttribute(
      "data-variant",
      "artist",
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Converge" }),
    ).toBeInTheDocument();
    expect(screen.getByText("3 albums")).toHaveClass("crate-mono-label");
    for (const [label, callback] of [
      ["Enrich", model.onEnrich],
      ["Analyze", model.onAnalyze],
      ["Edit", model.onEditMetadata],
      ["Core Tracks", model.onCreateCorePlaylist],
      ["Lyrics", model.onSyncLyrics],
      ["Metadata", model.onWritePortableMetadata],
      ["Export", model.onExportRichMetadata],
      ["Repair (2)", model.onRepair],
      ["Merge Alias", model.onMerge],
      ["Delete", model.onDelete],
    ] as const) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toHaveAttribute("data-size", "icon-lg");
      expect(button.textContent).toBe("");
      expect(button.querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
      await userEvent.click(button);
      expect(callback).toHaveBeenCalledOnce();
    }
    expect(container.querySelector("[title]")).toBeNull();
    for (const photoAction of screen.getAllByRole("button", {
      name: "Edit photo",
    })) {
      expect(photoAction).toHaveAttribute(
        "data-endpoint",
        "/api/artwork/artists/7/upload-photo",
      );
    }
    expect(
      screen.getByRole("button", { name: "Edit background" }),
    ).toHaveAttribute(
      "data-endpoint",
      "/api/artwork/artists/7/upload-background",
    );
    fireEvent.load(screen.getByRole("img", { name: "Converge" }));
    expect(model.onPhotoLoad).toHaveBeenCalledOnce();
  });
  it("preserves read-only and busy states", () => {
    const model = props();
    const { rerender } = render(
      <MemoryRouter>
        <ArtistHeroSection {...model} isAdmin={false} />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit photo" }),
    ).not.toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <ArtistHeroSection {...model} enriching metadataAction="lyrics" />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("button", { name: "Enriching artist" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Lyrics" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.getByRole("button", { name: "Metadata" })).toBeDisabled();
  });
  it("uses the mobile photo composition and retains a background fallback", () => {
    const model = props();
    const { rerender } = render(
      <MemoryRouter>
        <ArtistHeroSection {...model} />
      </MemoryRouter>,
    );
    expect(
      screen.getByTestId("mobile-artist-hero-frame").querySelector("img"),
    ).toHaveAttribute("src", expect.stringContaining("photo"));
    expect(screen.getAllByRole("button", { name: "Edit photo" })).toHaveLength(
      2,
    );
    rerender(
      <MemoryRouter>
        <ArtistHeroSection {...model} photoError />
      </MemoryRouter>,
    );
    expect(
      screen.getByTestId("mobile-artist-hero-frame").querySelector("img"),
    ).toHaveAttribute("src", expect.stringContaining("background"));
    expect(
      screen.getByTestId("desktop-artist-hero-frame").querySelector("img"),
    ).toHaveAttribute("src", expect.stringContaining("background"));
  });
  it("keeps origin, collection metrics and popularity on separate header rows", () => {
    const { container } = render(
      <MemoryRouter>
        <ArtistHeroSection {...props()} />
      </MemoryRouter>,
    );
    const origin = screen.getByText("Boston, US");
    const metrics = screen.getByTestId("page-hero-meta");
    const popularity = screen.getByText("Popularity 72%");
    expect(metrics).toContainElement(screen.getByText("3 albums"));
    expect(metrics).toContainElement(screen.getByText("15.0K listeners"));
    expect(metrics).not.toContainElement(origin);
    expect(metrics).not.toContainElement(popularity);
    expect(origin.parentElement).not.toContainElement(popularity);
    expect(popularity.tagName).toBe("P");
    // The Admin content edge must not inherit Listen's centered maximum width.
    expect(container.querySelector(".max-w-none")).toHaveClass("mx-0");
  });
  it("places artwork editing on the images and gives Core Tracks and Lyrics distinct glyphs", () => {
    render(
      <MemoryRouter>
        <ArtistHeroSection {...props()} />
      </MemoryRouter>,
    );
    const actions = screen.getByRole("group", { name: "Artist actions" });
    const artwork = screen.getByTestId("page-hero-artwork");
    const photoActions = screen.getAllByRole("button", { name: "Edit photo" });
    expect(photoActions.some((action) => artwork.contains(action))).toBe(true);
    for (const action of photoActions)
      expect(actions).not.toContainElement(action);
    expect(actions).not.toContainElement(
      screen.getByRole("button", { name: "Edit background" }),
    );
    expect(screen.getByRole("button", { name: "Edit background" })).toHaveClass(
      "absolute",
    );
    const corePaths = screen
      .getByRole("button", { name: "Core Tracks" })
      .querySelector("svg")?.innerHTML;
    const lyricsPaths = screen
      .getByRole("button", { name: "Lyrics" })
      .querySelector("svg")?.innerHTML;
    expect(corePaths).toBeTruthy();
    expect(lyricsPaths).toBeTruthy();
    expect(lyricsPaths).not.toBe(corePaths);
  });
});
