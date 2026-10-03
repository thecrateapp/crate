import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { PlaylistTrackList } from "@/components/playlists/PlaylistTrackList";
import type { PlaylistTrack } from "@/pages/playlist-types";

const trackRowProps: Array<Record<string, unknown>> = [];

vi.mock("@/components/ui/WindowVirtualList", () => ({
  WindowVirtualList: <T,>({
    items,
    renderItem,
  }: {
    items: T[];
    renderItem: (item: T, index: number) => ReactNode;
  }) => <div>{items.map((item, index) => renderItem(item, index))}</div>,
}));

vi.mock("@/components/cards/TrackRow", () => ({
  TrackRow: (props: Record<string, unknown>) => {
    trackRowProps.push(props);
    return null;
  },
}));

const tracks = [
  {
    id: 11,
    playlist_id: 1,
    track_id: 101,
    track_path: "a.flac",
    title: "One",
    artist: "High Vis",
    album: "Guided Tour",
    duration: 120,
  },
] as PlaylistTrack[];

describe("PlaylistTrackList", () => {
  it("keeps row data and play callbacks stable across re-renders", () => {
    const firstPlay = vi.fn();
    const secondPlay = vi.fn();
    const props = {
      filteredTracks: tracks,
      onActionMenuOpen: vi.fn(),
      onAddToPlaylist: vi.fn(),
      onCreatePlaylist: vi.fn(),
      playlistOptions: [],
    };

    const { rerender } = render(
      <PlaylistTrackList {...props} onPlayTrack={firstPlay} />,
    );
    rerender(<PlaylistTrackList {...props} onPlayTrack={secondPlay} />);

    const [first, second] = trackRowProps.slice(-2);
    expect(second?.track).toBe(first?.track);
    expect(second?.onPlayOverride).toBe(first?.onPlayOverride);

    (second?.onPlayOverride as () => void)();
    expect(secondPlay).toHaveBeenCalledWith(11);
    expect(firstPlay).not.toHaveBeenCalled();
  });
});
