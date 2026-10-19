import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import { LibraryBandcampHeader } from "./LibraryBandcampHeader";
import { LibraryBandcampImported } from "./LibraryBandcampImported";
import { LibraryContributionsTab } from "./LibraryContributionsTab";
import { LibraryBandcampTab } from "./LibraryBandcampTab";
import { LibraryPlaylistsTab } from "./LibraryPlaylistsTab";
const apiState = vi.hoisted(() => ({
  error: null as Error | null,
  data: null as unknown,
  refetch: vi.fn(),
}));
vi.mock("@/hooks/use-api", () => ({
  useApi: () => ({
    data: apiState.data,
    loading: false,
    error: apiState.error,
    refetch: apiState.refetch,
  }),
}));
vi.mock("@/contexts/PlaylistComposerContext", () => ({
  usePlaylistComposer: () => ({ openCreatePlaylist: vi.fn() }),
}));
beforeEach(() => {
  apiState.error = null;
  apiState.data = null;
  apiState.refetch.mockClear();
});
it("uses the common numeric and caption roles for actual Bandcamp counts including zero", () => {
  renderWithListenProviders(
    <LibraryBandcampHeader
      purchases={0}
      importedCount={2}
      wishlistCount={3}
      title="Bandcamp library"
      description="Actual library counts"
      purchasesLabel="Purchases"
      importedLabel="Imported"
      wishlistLabel="Wishlist"
    />,
  );
  expect(screen.getByText("0")).toHaveClass("font-display");
  expect(screen.getByText("Purchases")).toHaveClass("font-mono", "uppercase");
});
it("uses icon actions and preserves disabled export and withdrawal identity", () => {
  const contribution = {
    id: 9,
    album_id: null,
    artist_name: "Sample",
    album_name: "A record",
    source: "bandcamp",
    source_ref: "sample",
    status: "completed",
  };
  const onExport = vi.fn(),
    onWithdraw = vi.fn();
  const { container } = renderWithListenProviders(
    <LibraryBandcampImported
      contributions={[contribution]}
      title="Imported"
      description="In your library"
      exportLabel="Export"
      withdrawLabel="Remove contribution"
      onExport={onExport}
      onWithdraw={onWithdraw}
    />,
  );
  const exportButton = screen.getByRole("button", { name: "Export: A record" });
  expect(exportButton).toBeDisabled();
  expect(exportButton.textContent).toBe("");
  expect(
    container.querySelector('[data-slot="entity-row"]'),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Remove contribution: A record" }),
  );
  expect(onWithdraw).toHaveBeenCalledWith(contribution);
  expect(onExport).not.toHaveBeenCalled();
});
it.each([LibraryContributionsTab, LibraryBandcampTab, LibraryPlaylistsTab])(
  "shows a retryable read error instead of an empty library",
  (Tab) => {
    apiState.error = new Error("Read failed");
    renderWithListenProviders(<Tab />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(apiState.refetch).toHaveBeenCalled();
  },
);

it("preserves mixed-case owner identity in shared and followed playlists while count captions uppercase", () => {
  const record = {
    id: 4,
    name: "Shared music",
    user_id: 2,
    owner_name: "Jane McKay",
    track_count: 12,
    is_smart: false,
    total_duration: 0,
    created_at: "2026-10-19",
  };
  apiState.data = {
    playlists: [record],
    followed_playlists: [
      {
        ...record,
        id: 5,
        name: "Followed music",
        owner_name: null,
        owner_username: "DJCase",
      },
    ],
    followed_curated_playlists: [],
  };
  renderWithListenProviders(<LibraryPlaylistsTab />);
  for (const owner of ["Jane McKay", "@DJCase"]) {
    expect(
      screen.getByText(owner, { exact: true }).closest(".uppercase"),
    ).toBeNull();
  }
  for (const count of screen.getAllByText("12 tracks", { exact: true }))
    expect(count).toHaveClass("font-mono", "uppercase");
});
