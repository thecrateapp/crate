import { describe, expect, it, vi } from "vitest";

import type { PlaySource, Track } from "@/contexts/player-types";
import type { EngineQueueSnapshot } from "@/lib/playback-engine";
import {
  legacySmartTransitionSeconds,
  SMART_TRANSITION_LONG_SECONDS,
  SMART_TRANSITION_SHORT_SECONDS,
  SmartMixTransitionPlanner,
  type SmartMixCapabilities,
} from "@/lib/smart-mix";

const ENABLED_CAPABILITIES: SmartMixCapabilities = {
  available: true,
  androidNativeCrossfade: true,
  androidBeatmatch: true,
  plannerVersion: "smart-mix-v1",
};

const PLAYLIST_SOURCE: PlaySource = {
  type: "playlist",
  name: "Test queue",
  id: "playlist-1",
};

const TRACKS: Track[] = [
  {
    id: "runtime-1",
    entityUid: "11111111-1111-4111-8111-111111111111",
    title: "One",
    artist: "Band A",
  },
  {
    id: "runtime-2",
    entityUid: "22222222-2222-4222-8222-222222222222",
    title: "Two",
    artist: "Band B",
  },
  {
    id: "runtime-3",
    entityUid: "33333333-3333-4333-8333-333333333333",
    title: "Three",
    artist: "Band C",
  },
  {
    id: "runtime-4",
    entityUid: "44444444-4444-4444-8444-444444444444",
    title: "Four",
    artist: "Band D",
  },
];

function serverPlan(outgoing: Track, incoming: Track) {
  return {
    plannerVersion: 1 as const,
    outgoingTrackEntityUid: outgoing.entityUid!,
    incomingTrackEntityUid: incoming.entityUid!,
    mode: "adaptive" as const,
    durationMs: 4000,
    outgoingCueMs: 176000,
    incomingCueMs: 400,
    incomingTempoRatio: 1,
    beatPhaseOffsetMs: 0,
    handoffProgress: 0.5,
    outgoingGainDb: -1,
    incomingGainDb: 0,
    curve: "equal-power" as const,
    bassHandoff: "balanced" as const,
    confidence: 0.88,
    fallbackReason: null,
  };
}

describe("SmartMixTransitionPlanner", () => {
  it("requests only current→N+1 and N+1→N+2", async () => {
    const request = vi.fn().mockResolvedValue({
      plannerVersion: "smart-mix-v1",
      plans: [
        serverPlan(TRACKS[1]!, TRACKS[2]!),
        serverPlan(TRACKS[2]!, TRACKS[3]!),
      ],
    });
    const planner = new SmartMixTransitionPlanner(request);

    const plans = await planner.plan({
      revision: "queue-revision-1",
      tracks: TRACKS,
      currentIndex: 1,
      playSource: PLAYLIST_SOURCE,
      shuffle: false,
      offline: false,
      preferredDurationMs: 4000,
      capabilities: ENABLED_CAPABILITIES,
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "/api/playback/transition-plans",
      "POST",
      {
        plannerVersion: "smart-mix-v1",
        edges: [
          expect.objectContaining({
            outgoingTrackEntityUid: TRACKS[1]!.entityUid,
            incomingTrackEntityUid: TRACKS[2]!.entityUid,
          }),
          expect.objectContaining({
            outgoingTrackEntityUid: TRACKS[2]!.entityUid,
            incomingTrackEntityUid: TRACKS[3]!.entityUid,
          }),
        ],
      },
      { signal: expect.any(AbortSignal) },
    );
    expect(
      plans.map((plan) => [plan.outgoingTrackId, plan.incomingTrackId]),
    ).toEqual([
      ["runtime-2", "runtime-3"],
      ["runtime-3", "runtime-4"],
    ]);
  });

  it("uses local gapless plans for a known album order without network", async () => {
    const request = vi.fn();
    const planner = new SmartMixTransitionPlanner(request);
    const albumTracks = TRACKS.slice(0, 3).map((track) => ({
      ...track,
      artist: "Dredg",
      album: "El Cielo",
    }));

    const plans = await planner.plan({
      revision: "album-revision",
      tracks: albumTracks,
      currentIndex: 0,
      playSource: { type: "album", name: "El Cielo", id: 1 },
      shuffle: false,
      offline: false,
      preferredDurationMs: 4000,
      capabilities: ENABLED_CAPABILITIES,
    });

    expect(request).not.toHaveBeenCalled();
    expect(plans).toHaveLength(2);
    expect(plans.every((plan) => plan.mode === "gapless")).toBe(true);
    expect(plans.every((plan) => plan.durationMs === 0)).toBe(true);
  });

  it("aborts an in-flight request when the queue revision changes", async () => {
    const signals: AbortSignal[] = [];
    const pending: Array<{
      resolve: (value: {
        plannerVersion: "smart-mix-v1";
        plans: ReturnType<typeof serverPlan>[];
      }) => void;
      reject: (reason?: unknown) => void;
    }> = [];
    const request = vi.fn(
      (
        _path: string,
        _method: string,
        _body: unknown,
        options: { signal: AbortSignal },
      ) => {
        signals.push(options.signal);
        return new Promise<{
          plannerVersion: "smart-mix-v1";
          plans: ReturnType<typeof serverPlan>[];
        }>((resolve, reject) => {
          pending.push({ resolve, reject });
          options.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    );
    const planner = new SmartMixTransitionPlanner(request);

    const first = planner.plan({
      revision: "queue-revision-1",
      tracks: TRACKS,
      currentIndex: 0,
      playSource: PLAYLIST_SOURCE,
      shuffle: false,
      offline: false,
      preferredDurationMs: 4000,
      capabilities: ENABLED_CAPABILITIES,
    });
    const second = planner.plan({
      revision: "queue-revision-2",
      tracks: TRACKS,
      currentIndex: 1,
      playSource: PLAYLIST_SOURCE,
      shuffle: false,
      offline: false,
      preferredDurationMs: 4000,
      capabilities: ENABLED_CAPABILITIES,
    });

    expect(signals[0]?.aborted).toBe(true);
    pending[1]!.resolve({
      plannerVersion: "smart-mix-v1",
      plans: [
        serverPlan(TRACKS[1]!, TRACKS[2]!),
        serverPlan(TRACKS[2]!, TRACKS[3]!),
      ],
    });
    await expect(first).resolves.toEqual([]);
    await expect(second).resolves.toHaveLength(2);
  });

  it("returns explicit local safe plans when the capability is unavailable", async () => {
    const request = vi.fn();
    const planner = new SmartMixTransitionPlanner(request);

    const plans = await planner.plan({
      revision: "safe-revision",
      tracks: TRACKS,
      currentIndex: 0,
      playSource: PLAYLIST_SOURCE,
      shuffle: false,
      offline: false,
      preferredDurationMs: 3000,
      capabilities: {
        ...ENABLED_CAPABILITIES,
        available: false,
        plannerVersion: null,
      },
    });

    expect(request).not.toHaveBeenCalled();
    expect(plans).toHaveLength(2);
    expect(plans).toEqual([
      expect.objectContaining({
        outgoingTrackId: "runtime-1",
        incomingTrackId: "runtime-2",
        mode: "gapless",
        durationMs: 0,
        fallbackReason: "capability_unavailable",
      }),
      expect.objectContaining({
        outgoingTrackId: "runtime-2",
        incomingTrackId: "runtime-3",
        mode: "gapless",
        durationMs: 0,
        fallbackReason: "capability_unavailable",
      }),
    ]);
  });

  it("copies only the transition contract and never server credentials", async () => {
    const request = vi.fn().mockResolvedValue({
      plannerVersion: "smart-mix-v1",
      plans: [
        {
          ...serverPlan(TRACKS[0]!, TRACKS[1]!),
          authorization: "Bearer secret",
          streamUrl: "https://media.example/secret",
          token: "secret-token",
        },
        serverPlan(TRACKS[1]!, TRACKS[2]!),
      ],
    });
    const planner = new SmartMixTransitionPlanner(request);

    const plans = await planner.plan({
      revision: "credential-revision",
      tracks: TRACKS,
      currentIndex: 0,
      playSource: PLAYLIST_SOURCE,
      shuffle: false,
      offline: false,
      preferredDurationMs: 4000,
      capabilities: ENABLED_CAPABILITIES,
    });

    const serialized = JSON.stringify(plans);
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("streamUrl");
  });

  it("retains safe transition plans in offline queue metadata", async () => {
    const planner = new SmartMixTransitionPlanner(vi.fn());
    const transitionPlans = await planner.plan({
      revision: "offline-revision",
      tracks: TRACKS,
      currentIndex: 0,
      playSource: PLAYLIST_SOURCE,
      shuffle: false,
      offline: true,
      preferredDurationMs: 2500,
      capabilities: {
        ...ENABLED_CAPABILITIES,
        available: false,
      },
    });
    const snapshot: EngineQueueSnapshot = {
      revision: "offline-revision",
      tracks: [],
      currentIndex: 0,
      positionMs: 0,
      autoplay: false,
      repeat: "off",
      crossfadeMs: 2500,
      volume: 1,
      transitionPlans,
    };

    const restored = JSON.parse(
      JSON.stringify(snapshot),
    ) as EngineQueueSnapshot;
    expect(restored.transitionPlans).toHaveLength(2);
    expect(restored.transitionPlans?.[0]?.fallbackReason).toBe(
      "capability_unavailable",
    );
  });
});

describe("legacySmartTransitionSeconds", () => {
  it("keeps the desktop compatibility weighting while native planning migrates", () => {
    const compatible = [
      {
        ...TRACKS[0]!,
        bpm: 120,
        audioKey: "C",
        audioScale: "major",
        energy: 0.72,
        danceability: 0.48,
        valence: 0.34,
        blissVector: [0.2, 0.4, 0.6, 0.8],
      },
      {
        ...TRACKS[1]!,
        bpm: 124,
        audioKey: "G",
        audioScale: "major",
        energy: 0.76,
        danceability: 0.52,
        valence: 0.38,
        blissVector: [0.21, 0.39, 0.62, 0.79],
      },
    ];
    const clashing = {
      ...TRACKS[2]!,
      bpm: 176,
      audioKey: "F#",
      audioScale: "minor",
      energy: 0.12,
      danceability: 0.15,
      valence: 0.92,
      blissVector: [-0.8, -0.6, -0.4, -0.2],
    };

    expect(
      legacySmartTransitionSeconds(
        compatible[0],
        compatible[1]!,
        PLAYLIST_SOURCE,
        false,
      ),
    ).toBe(SMART_TRANSITION_LONG_SECONDS);
    expect(
      legacySmartTransitionSeconds(
        compatible[0],
        clashing,
        PLAYLIST_SOURCE,
        false,
      ),
    ).toBe(SMART_TRANSITION_SHORT_SECONDS);
  });
});
