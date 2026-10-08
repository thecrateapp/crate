import { describe, expect, it } from "vitest";

import type { Track } from "@/contexts/player-types";
import type { EngineTransitionEvent } from "@/lib/playback-engine";
import { resolveNativeCrossfadeTransition } from "@/lib/native-transition-visual";

const queue: Track[] = [
  {
    id: "outgoing",
    title: "Outgoing",
    artist: "Artist",
    duration: 180,
  },
  {
    id: "incoming",
    title: "Incoming",
    artist: "Artist",
    duration: 210,
  },
];

function event(
  overrides: Partial<EngineTransitionEvent> = {},
): EngineTransitionEvent {
  return {
    revision: "queue-1",
    type: "crossfade",
    outgoingTrackId: "outgoing",
    incomingTrackId: "incoming",
    outgoingIndex: 0,
    incomingIndex: 1,
    durationMs: 3000,
    progress: 0,
    ...overrides,
  };
}

describe("resolveNativeCrossfadeTransition", () => {
  it("uses queue indices and native progress to align the visual transition", () => {
    expect(
      resolveNativeCrossfadeTransition(
        event({ progress: 0.25 }),
        queue,
        75_000,
      ),
    ).toEqual({
      outgoing: queue[0],
      incoming: queue[1],
      durationMs: 3000,
      startedAt: 74_250,
      outgoingDurationSeconds: 180,
    });
  });

  it("falls back to track ids when queue indices are absent", () => {
    const result = resolveNativeCrossfadeTransition(
      event({ outgoingIndex: undefined, incomingIndex: undefined }),
      queue,
      12_000,
    );

    expect(result?.outgoing).toBe(queue[0]);
    expect(result?.incoming).toBe(queue[1]);
  });

  it("rejects stale, incomplete, or non-crossfade transition events", () => {
    expect(
      resolveNativeCrossfadeTransition(
        event({ incomingTrackId: "stale", incomingIndex: 42 }),
        queue,
        0,
      ),
    ).toBeNull();
    expect(
      resolveNativeCrossfadeTransition(event({ durationMs: 0 }), queue, 0),
    ).toBeNull();
    expect(
      resolveNativeCrossfadeTransition(event({ type: "gapless" }), queue, 0),
    ).toBeNull();
  });
});
