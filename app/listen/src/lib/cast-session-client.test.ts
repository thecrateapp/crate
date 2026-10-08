import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: apiMock }));

import {
  buildCastQueueUpdateRequest,
  buildCastSessionRequest,
  createCastPlaybackSession,
  revokeCastPlaybackSession,
  updateCastPlaybackSession,
} from "./cast-session-client";

const queue = [
  {
    id: "first",
    libraryTrackId: 10,
    title: "First",
    artist: "Artist",
    albumCover: "https://images.example/first.jpg",
  },
  {
    id: "second",
    entityUid: "11111111-1111-1111-1111-111111111111",
    title: "Second",
    artist: "Artist",
  },
];

describe("Cast session client", () => {
  beforeEach(() => vi.clearAllMocks());

  it("serializes the full queue, cursor, modes and safe appearance", () => {
    expect(
      buildCastSessionRequest({
        track: queue[1]!,
        queue,
        currentIndex: 1,
        currentTime: 19.7,
        repeatMode: "all",
        shuffle: true,
        targetDeviceId: "google-cast:default",
        appearance: {
          contractVersion: 1,
          skinId: "crateRed",
          preferredMode: "system",
          resolvedMode: "light",
          reducedMotion: true,
        },
      }),
    ).toEqual({
      protocol_version: 1,
      target_device_id: "google-cast:default",
      receiver_capabilities: expect.objectContaining({
        formats: ["mp3", "aac", "m4a"],
      }),
      appearance: {
        contract_version: 1,
        skin_id: "crate-red",
        preferred_mode: "system",
        resolved_mode: "light",
        reduced_motion: true,
      },
      current_index: 1,
      current_time: 19.7,
      repeat_mode: "all",
      shuffle: true,
      revision: 0,
      items: [
        {
          item_id: "track-10-1",
          track_id: 10,
        },
        {
          item_id: "entity-11111111-1111-1111-1111-111111111111-1",
          track_entity_uid: "11111111-1111-1111-1111-111111111111",
        },
      ],
    });
  });

  it("keeps occurrence ids stable when distinct tracks are reordered", () => {
    const original = buildCastSessionRequest({
      track: queue[0]!,
      queue,
    }).items;
    const reordered = buildCastSessionRequest({
      track: queue[0]!,
      queue: [queue[1]!, queue[0]!],
    }).items;

    expect(reordered.map((item) => item.item_id)).toEqual([
      original[1]?.item_id,
      original[0]?.item_id,
    ]);
  });

  it("preserves duplicate item ids across queue edits", () => {
    const duplicate = queue[0]!;
    const previous = [
      {
        item_id: "track-10-1",
        track_id: 10,
        title: "First",
        artist: "Artist",
        content_type: "audio/mpeg",
        stream_url: "https://api.test/one",
        metadata_url: "https://api.test/one/meta",
      },
      {
        item_id: "track-10-2",
        track_id: 10,
        title: "First",
        artist: "Artist",
        content_type: "audio/mpeg",
        stream_url: "https://api.test/two",
        metadata_url: "https://api.test/two/meta",
      },
    ];

    expect(
      buildCastQueueUpdateRequest(
        [duplicate, duplicate],
        previous,
        4,
        "mutation-1",
        "one",
        true,
      ),
    ).toEqual({
      expected_revision: 4,
      mutation_id: "mutation-1",
      repeat_mode: "one",
      shuffle: true,
      items: [
        { item_id: "track-10-1", track_id: 10 },
        { item_id: "track-10-2", track_id: 10 },
      ],
    });
  });

  it("rejects a queue containing an item without a stable reference", () => {
    expect(() =>
      buildCastSessionRequest({
        track: queue[0]!,
        queue: [queue[0]!, { id: "ephemeral", title: "X", artist: "Y" }],
      }),
    ).toThrow("CAST_QUEUE_REFERENCE_MISSING");
  });

  it("creates and revokes a scoped session through authenticated routes", async () => {
    apiMock.mockResolvedValueOnce({ session_id: "session-1" });
    const payload = { track: queue[0]!, queue, currentIndex: 0 };

    await expect(createCastPlaybackSession(payload)).resolves.toEqual({
      session_id: "session-1",
    });
    expect(apiMock).toHaveBeenNthCalledWith(
      1,
      "/api/me/cast/sessions",
      "POST",
      buildCastSessionRequest(payload),
    );

    apiMock.mockResolvedValueOnce({ ok: true });
    await revokeCastPlaybackSession("session-1");
    expect(apiMock).toHaveBeenNthCalledWith(
      2,
      "/api/me/cast/sessions/session-1",
      "DELETE",
    );
  });

  it("updates a Cast queue with a stable mutation id", async () => {
    apiMock.mockResolvedValueOnce({ mutation_status: "applied" });

    await updateCastPlaybackSession("session-1", {
      expected_revision: 4,
      mutation_id: "mutation-1",
      items: [{ item_id: "track-10-1", track_id: 10 }],
    });

    expect(apiMock).toHaveBeenCalledWith(
      "/api/me/cast/sessions/session-1",
      "PATCH",
      {
        expected_revision: 4,
        mutation_id: "mutation-1",
        items: [{ item_id: "track-10-1", track_id: 10 }],
      },
    );
  });
});
