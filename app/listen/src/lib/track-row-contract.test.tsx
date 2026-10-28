import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PathTrackList } from "@/pages/PathDetailParts";
import { QueueTrackRow } from "@/components/player/QueueTrackRow";
import { SuggestedTrackRow } from "@/components/player/extended/SuggestedTrackRow";
import { HomeReplaySection } from "@/components/home/HomeReplaySection";
import { PlaylistTrackList } from "@/components/playlists/PlaylistTrackList";
import { SearchResultsView } from "@/components/explore/ExploreSearchResults";
import { statsTrackRowData } from "@/components/stats/stats-model";
import { buildTrackRowData } from "@/pages/search-results-model";
import { topTrackToTrackRowData } from "@/components/artist/artist-model";
import { toRadioTrack, toShapedRadioTrack } from "./radio-model";
import { payloadToTrack } from "@/pages/jam-queue-model";
import { getStoredQueue, saveQueue } from "@/contexts/player-utils";
import { toTrackRowData } from "./track-row-data";
import { toPlayableTrack } from "./playable-track";
import { toOfflinePlayerTrack } from "@/pages/offline-library-model";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

vi.mock("@/contexts/LikedTracksContext", () => ({
  useLikedTracks: () => ({ isLiked: () => false, toggleTrackLike: vi.fn() }),
}));

const media = {
  format: "flac",
  bitrate: 1200,
  sample_rate: 96000,
  bit_depth: 24,
  duration: 143,
  bpm: 99,
  audio_key: "D",
  audio_scale: "minor",
};
const track = {
  ...media,
  id: 7,
  track_id: 7,
  title: "Complete source",
  artist: "Caspian",
  album: "Caspian",
  path: "/music/caspian/07.flac",
  album_id: 2,
};

// Exercise real page adapters and the round trip through the player/queue and offline store.
const adapters = {
  search: () => buildTrackRowData([track])[0],
  artist: () => topTrackToTrackRowData({ ...track, id: "7", track: 7 }),
  stats: () =>
    statsTrackRowData({
      ...track,
      track_path: track.path,
      complete_play_count: 2,
      play_count: 3,
      minutes_listened: 7,
    }),
  radio: () => toTrackRowData(toRadioTrack(track)),
  shapedRadio: () =>
    toTrackRowData(toShapedRadioTrack({ ...track, distance: 0.1 })),
  jam: () => toTrackRowData(payloadToTrack(track)!),
  restoredQueue: () => {
    saveQueue([toPlayableTrack(track)], 0);
    return toTrackRowData(getStoredQueue().queue[0]!);
  },
  queue: () => toTrackRowData(toPlayableTrack(track)),
  offline: () =>
    toTrackRowData(
      toOfflinePlayerTrack({
        ...track,
        entity_uid: "track-7",
        stream_url: "/stream",
        download_url: "/download",
      }),
    ),
};

describe("complete TrackRow source contract", () => {
  it.each(Object.entries(adapters))(
    "preserves every technical field through %s",
    (_name, adapt) => {
      expect(adapt()).toMatchObject(media);
    },
  );
  it.each([320, 320000])(
    "normalizes legacy %s bitrate to kbps before row and player display",
    (bitrate) => {
      const source = { ...track, format: "mp3", bitrate };
      expect(toPlayableTrack(source).bitrate).toBe(320);
      expect(toTrackRowData(source).bitrate).toBe(320);
    },
  );
  it("does not invent unknown quality, analysis or duration", () => {
    const row = toTrackRowData({ id: 1, title: "Unknown", artist: "Artist" });
    expect(row).toMatchObject({
      bitrate: null,
      sample_rate: null,
      bit_depth: null,
      bpm: null,
      audio_key: null,
      audio_scale: null,
    });
    expect(row.duration).toBeUndefined();
    expect(row.format).toBeUndefined();
  });
});

const noop = () => {};
const views = {
  paths: (
    <PathTrackList
      path={{
        id: 1,
        name: "Path",
        origin: { type: "track", value: "7", label: "Origin" },
        destination: { type: "track", value: "8", label: "End" },
        waypoints: [],
        step_count: 1,
        created_at: "2026-10-21",
        tracks: [{ ...track, step: 0, progress: 0, distance: 0.1 }],
      }}
    />
  ),
  queue: (
    <QueueTrackRow
      track={toPlayableTrack(track)}
      queueIndex={0}
      onJump={noop}
    />
  ),
  suggested: <SuggestedTrackRow track={track} index={0} onPlay={noop} />,
  replay: (
    <HomeReplaySection
      replayPreview={[
        {
          ...track,
          track_path: track.path,
          play_count: 3,
          complete_play_count: 2,
          minutes_listened: 7,
        },
      ]}
      onOpenStats={noop}
      onPlayReplay={noop}
      onPlayTrack={noop}
    />
  ),
  playlist: (
    <PlaylistTrackList
      filteredTracks={[
        {
          ...track,
          playlist_id: 1,
          track_path: track.path,
          position: 0,
          added_at: "2026-10-21",
        },
      ]}
      onPlayTrack={noop}
      onActionMenuOpen={noop}
      onAddToPlaylist={noop}
      onCreatePlaylist={noop}
      playlistOptions={[]}
    />
  ),
  explore: (
    <SearchResultsView results={{ artists: [], albums: [], tracks: [track] }} />
  ),
};

it.each(Object.entries(views))(
  "%s renders quality, BPM/key and duration in the canonical slots",
  (_name, view) => {
    renderWithListenProviders(view);
    const row = screen.getByRole("row", { name: "Complete source" });
    expect(within(row).queryByText("0.100")).not.toBeInTheDocument();
    expect(within(row).getByText("Hi-Res 24/96")).toBeInTheDocument();
    expect(row.querySelector('[data-track-slot="quality"]')).toHaveTextContent(
      "Hi-Res 24/96",
    );
    expect(row.querySelector('[data-track-slot="analysis"]')).toHaveTextContent(
      "99",
    );
    expect(row.querySelector('[data-track-slot="analysis"]')).toHaveTextContent(
      "7A",
    );
    expect(row.querySelector('[data-track-slot="duration"]')).toHaveTextContent(
      "2:23",
    );
  },
);
