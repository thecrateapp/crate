import { describe, expect, it } from "vitest";

import type { Track } from "@/contexts/PlayerContext";
import {
  initialJamSessionState,
  jamSessionReducer,
  type JamRoom,
} from "@/pages/jam-reducer";

function makeRoom(overrides: Partial<JamRoom> = {}): JamRoom {
  return {
    id: "abc",
    host_user_id: 1,
    name: "Test Room",
    status: "active",
    visibility: "public",
    is_permanent: false,
    created_at: "2026-05-12T00:00:00Z",
    members: [],
    events: [],
    ...overrides,
  };
}

describe("jamSessionReducer", () => {
  it("returns initial state for unknown actions", () => {
    // @ts-expect-error testing unknown action
    const next = jamSessionReducer(initialJamSessionState, { type: "UNKNOWN" });
    expect(next).toEqual(initialJamSessionState);
  });

  it("sets room search", () => {
    const next = jamSessionReducer(initialJamSessionState, {
      type: "SET_ROOM_SEARCH",
      payload: "rock",
    });
    expect(next.roomSearch).toBe("rock");
  });

  it("sets room name", () => {
    const next = jamSessionReducer(initialJamSessionState, {
      type: "SET_ROOM_NAME",
      payload: "Friday night",
    });
    expect(next.roomName).toBe("Friday night");
  });

  it("applies room data", () => {
    const room = makeRoom();
    const next = jamSessionReducer(initialJamSessionState, {
      type: "APPLY_ROOM_DATA",
      payload: room,
    });
    expect(next.room).toEqual(room);
    expect(next.sharedQueue).toEqual([]);
  });

  it("adds track to shared queue", () => {
    const track = { id: "t1", title: "Song", artist: "Artist" } as Track;
    const next = jamSessionReducer(initialJamSessionState, {
      type: "QUEUE_ADD",
      payload: track,
    });
    expect(next.sharedQueue).toHaveLength(1);
    expect(next.sharedQueue[0]).toEqual(track);
  });

  it("removes track from shared queue by index", () => {
    const state = {
      ...initialJamSessionState,
      sharedQueue: [
        { id: "t1", title: "A", artist: "A" },
        { id: "t2", title: "B", artist: "B" },
      ] as Track[],
    };
    const next = jamSessionReducer(state, { type: "QUEUE_REMOVE", payload: 0 });
    expect(next.sharedQueue).toHaveLength(1);
    expect(next.sharedQueue[0]!.id).toBe("t2");
  });

  it("reorders shared queue", () => {
    const state = {
      ...initialJamSessionState,
      sharedQueue: [
        { id: "t1", title: "A", artist: "A" },
        { id: "t2", title: "B", artist: "B" },
        { id: "t3", title: "C", artist: "C" },
      ] as Track[],
    };
    const next = jamSessionReducer(state, {
      type: "QUEUE_REORDER",
      payload: { fromIndex: 0, toIndex: 2 },
    });
    expect(next.sharedQueue.map((t) => t.id)).toEqual(["t2", "t3", "t1"]);
  });

  it("marks websocket open", () => {
    const next = jamSessionReducer(initialJamSessionState, {
      type: "WEBSOCKET_OPEN",
    });
    expect(next.isConnected).toBe(true);
    expect(next.connectionProblem).toBeNull();
  });

  it("handles websocket close with code 4409", () => {
    const state = {
      ...initialJamSessionState,
      room: makeRoom({ name: "Room" }),
    };
    const next = jamSessionReducer(state, {
      type: "WEBSOCKET_CLOSED",
      payload: { code: 4409, message: "" },
    });
    expect(next.room!.status).toBe("ended");
    expect(next.isConnected).toBe(false);
  });
});
