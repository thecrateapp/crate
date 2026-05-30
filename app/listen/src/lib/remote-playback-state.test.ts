import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PlaySource, Track } from "@/contexts/player-types";
import {
  buildPlaybackStatePayload,
  compactPlaySource,
  compactTrackReference,
  isRecentlyPlayingRemote,
  remotePlaybackQueue,
  shouldPromptForRemoteResume,
  type RemotePlaybackState,
} from "@/lib/remote-playback-state";

const TRACK: Track = {
  id: "track-local",
  libraryTrackId: 12,
  entityUid: "11111111-1111-1111-1111-111111111111",
  title: "H.O.O.D",
  artist: "Kneecap",
  album: "H.O.O.D",
  albumCover: "/api/albums/1/cover",
  duration: 173,
  path: "Kneecap/H.O.O.D/01.flac",
};

const REMOTE_STATE: RemotePlaybackState = {
  device_id: "desktop",
  device_label: "Desktop",
  status: "paused",
  title: "Remote Track",
  artist: "Remote Artist",
  album: "Remote Album",
  position_ms: 42000,
  duration_ms: 180000,
  current_index: 0,
  queue: [
    {
      track_id: 44,
      track_entity_uid: "22222222-2222-2222-2222-222222222222",
      title: "Remote Track",
      artist: "Remote Artist",
      album: "Remote Album",
      duration: 180,
      album_cover: "/api/albums/2/cover",
    },
  ],
  repeat_mode: "off",
  shuffle: false,
  updated_at: "2026-05-25T10:00:00.000Z",
};

beforeEach(() => {
  localStorage.setItem("listen-device-fingerprint", "phone");
});

afterEach(() => {
  localStorage.clear();
});

describe("compactTrackReference", () => {
  it("keeps only receiver-safe track identity and display fields", () => {
    expect(compactTrackReference(TRACK)).toEqual({
      track_id: 12,
      track_entity_uid: "11111111-1111-1111-1111-111111111111",
      path: "Kneecap/H.O.O.D/01.flac",
      title: "H.O.O.D",
      artist: "Kneecap",
      album: "H.O.O.D",
      duration: 173,
      album_cover: "/api/albums/1/cover",
    });
  });
});

describe("compactPlaySource", () => {
  it("drops route hrefs from playback source snapshots", () => {
    const source: PlaySource = {
      type: "album",
      name: "Album",
      id: 7,
      href: "/album/7",
    };

    expect(compactPlaySource(source)).toEqual({
      type: "album",
      name: "Album",
      id: 7,
      radio: undefined,
    });
  });
});

describe("buildPlaybackStatePayload", () => {
  it("includes queue snapshots only for structural updates", () => {
    const structural = buildPlaybackStatePayload({
      queue: [TRACK],
      currentIndex: 0,
      currentTime: 42,
      duration: 173,
      isPlaying: false,
      repeat: "off",
      shuffle: false,
      playSource: { type: "album", name: "Album", id: 7 },
      snapshotKind: "structural",
    });

    expect(structural).toMatchObject({
      snapshot_kind: "structural",
      status: "paused",
      track_id: 12,
      track_entity_uid: "11111111-1111-1111-1111-111111111111",
      position_ms: 42000,
      duration_ms: 173000,
      queue: [compactTrackReference(TRACK)],
    });

    const light = buildPlaybackStatePayload({
      queue: [TRACK],
      currentIndex: 0,
      currentTime: 43,
      duration: 173,
      isPlaying: true,
      repeat: "off",
      shuffle: false,
      playSource: { type: "album", name: "Album", id: 7 },
      snapshotKind: "light",
    });

    expect(light.status).toBe("playing");
    expect(light.queue).toBeUndefined();
    expect(light.play_source).toBeUndefined();
  });

  it("marks explicit active ownership claims without changing ordinary checkpoints", () => {
    const ordinary = buildPlaybackStatePayload({
      queue: [TRACK],
      currentIndex: 0,
      currentTime: 1,
      duration: 173,
      isPlaying: true,
      repeat: "off",
      shuffle: false,
      playSource: { type: "album", name: "Album", id: 7 },
      snapshotKind: "light",
    });
    const claimed = buildPlaybackStatePayload({
      queue: [TRACK],
      currentIndex: 0,
      currentTime: 1,
      duration: 173,
      isPlaying: true,
      repeat: "off",
      shuffle: false,
      playSource: { type: "album", name: "Album", id: 7 },
      snapshotKind: "light",
      claimActive: true,
    });

    expect(ordinary.claim_active).toBeUndefined();
    expect(claimed.claim_active).toBe(true);
  });
});

describe("remotePlaybackQueue", () => {
  it("converts remote compact snapshots back into player tracks", () => {
    expect(remotePlaybackQueue(REMOTE_STATE)).toEqual([
      {
        id: "22222222-2222-2222-2222-222222222222",
        entityUid: "22222222-2222-2222-2222-222222222222",
        libraryTrackId: 44,
        path: undefined,
        title: "Remote Track",
        artist: "Remote Artist",
        album: "Remote Album",
        albumCover: "/api/albums/2/cover",
        duration: 180,
      },
    ]);
  });

  it("falls back to the current track fields when no queue snapshot exists", () => {
    expect(
      remotePlaybackQueue({
        ...REMOTE_STATE,
        queue: [],
        track_id: 55,
        track_path: "Remote/Album/track.flac",
      }),
    ).toEqual([
      expect.objectContaining({
        id: "55",
        libraryTrackId: 55,
        path: "Remote/Album/track.flac",
        title: "Remote Track",
      }),
    ]);
  });
});

describe("shouldPromptForRemoteResume", () => {
  it("prompts when another device has a newer playable state", () => {
    expect(
      shouldPromptForRemoteResume(REMOTE_STATE, {
        localSavedAt: "2026-05-25T09:59:00.000Z",
      }),
    ).toBe(true);
  });

  it("does not prompt for the same device or when local restore is newer", () => {
    expect(
      shouldPromptForRemoteResume(
        { ...REMOTE_STATE, device_id: "phone" },
        { localSavedAt: "2026-05-25T09:59:00.000Z" },
      ),
    ).toBe(false);
    expect(
      shouldPromptForRemoteResume(REMOTE_STATE, {
        localSavedAt: "2026-05-25T10:01:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("isRecentlyPlayingRemote", () => {
  it("treats active playing states inside the presence window as recently playing", () => {
    expect(
      isRecentlyPlayingRemote(
        {
          ...REMOTE_STATE,
          status: "playing",
          updated_at: "2026-05-25T10:00:00.000Z",
        },
        Date.parse("2026-05-25T10:01:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isRecentlyPlayingRemote(
        {
          ...REMOTE_STATE,
          status: "playing",
          updated_at: "2026-05-25T10:00:00.000Z",
        },
        Date.parse("2026-05-25T10:02:00.000Z"),
      ),
    ).toBe(false);
  });
});
