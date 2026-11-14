import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePlayerConnectV2Sync } from "./use-player-connect-v2-sync";

const sendMessage = vi.fn();
const requestTransfer = vi.fn();
const sendSnapshot = vi.fn();
const sendVolume = vi.fn();
const connectedInstances = [{ instance_id: "other" }];

vi.mock("@/hooks/use-crate-connect-ws", () => ({
  useCrateConnectWs: () => ({
    activeInstanceId: "local",
    connectedInstances,
    playbackInstanceId: "local",
    playerState: null,
    requestTransfer,
    serverClockOffsetMs: 0,
    sendMessage,
    sendSnapshot,
    sendVolume,
  }),
}));

function options(connectV2Enabled: boolean) {
  const noop = () => {};
  return {
    applyConnectStateToLocalQueue: () => false,
    authUserId: 1,
    buildConnectSnapshotPayload: () => ({}) as never,
    connectV2Enabled,
    connectV2PublishRef: { current: null },
    currentIndex: 0,
    currentTimeRef: { current: 0 },
    isPlaying: false,
    isPlayingRef: { current: false },
    playSource: null,
    publishConnectState: async () => {},
    queue: [],
    queueRef: { current: [] },
    repeat: "off" as const,
    requireUserGestureToResume: noop,
    shuffle: false,
    volume: 1,
    pause: noop,
    resume: noop,
    next: noop,
    prev: noop,
    seek: noop,
    setVolume: noop,
  };
}

describe("usePlayerConnectV2Sync", () => {
  // The player memoises its connect value and its actions on this object.
  // A new object per render re-renders every consumer of the player actions
  // on every progress commit.
  it.each([true, false])(
    "returns the same runtime object while its inputs are unchanged (connect v2 %s)",
    (enabled) => {
      const props = options(enabled);
      const { result, rerender } = renderHook(
        (p: ReturnType<typeof options>) => usePlayerConnectV2Sync(p as never),
        { initialProps: props },
      );
      const first = result.current;
      rerender(props);
      expect(result.current).toBe(first);
    },
  );
});
