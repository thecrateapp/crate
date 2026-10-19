import { createRef, type ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AlbumTrackList } from "./AlbumTrackList";
import type { AlbumTrack, AlbumData } from "@/pages/album-types";
import type { TrackRowProps } from "@/components/cards/TrackRow";
vi.mock("@/components/cards/TrackRow", () => ({
  TrackRow: (props: TrackRowProps) => (
    <button
      onClick={() => props.onPlayOverride?.()}
      data-selected={props.selected}
    >
      {props.track.title}
    </button>
  ),
}));
vi.mock("@/components/actions/ItemActionMenu", () => ({
  ContextMenu: () => null,
}));
function track(id: number, disc: string): AlbumTrack {
  return {
    id,
    tags: { title: `Track ${id}`, discnumber: disc, tracknumber: "1" },
  } as AlbumTrack;
}
it("uses named TrackLists for sorted discs while retaining track identity, selection and play callbacks", () => {
  const onPlay = vi.fn();
  const props = {
    data: {
      tracks: [track(20, "2"), track(10, "1"), track(21, "2")],
    } as AlbumData,
    coverUrl: "",
    selectedTrackIds: [20],
    selectedAlbumTracks: [],
    isDesktop: true,
    canPersistAlbum: true,
    playlists: [],
    selectionPlaylistPickerOpen: false,
    selectionMenuController: { open: false },
    selectionMenuItems: [],
    selectionBarRef: createRef<HTMLDivElement>(),
    onPlayTrack: onPlay,
    trackPreviewId: (t: AlbumTrack) => `preview-${t.id}`,
    sharedTrackClass: () => "shared-preview",
    albumTrackRowData: (t: AlbumTrack) => ({
      id: t.id,
      title: t.tags.title,
      artist: "Artist",
    }),
    t: (_key: string, options?: { disc?: number }) => `Disc ${options?.disc}`,
  } as unknown as ComponentProps<typeof AlbumTrackList>;
  const { container } = render(<AlbumTrackList {...props} />);
  expect(screen.getAllByTestId("track-list")).toHaveLength(2);
  expect(screen.getByRole("group", { name: "Disc 1" })).toBeInTheDocument();
  expect(
    screen.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["Track 10", "Track 20", "Track 21"]);
  expect(container.querySelector("#preview-20")).toHaveClass("shared-preview");
  expect(screen.getByRole("button", { name: "Track 20" })).toHaveAttribute(
    "data-selected",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Track 21" }));
  expect(onPlay).toHaveBeenCalledWith(21);
});
