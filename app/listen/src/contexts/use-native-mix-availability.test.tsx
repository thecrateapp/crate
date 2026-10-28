import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineMixState } from "@/lib/playback-engine";
import { useNativeMixAvailability } from "./use-native-mix-availability";
import { usePlayerRuntimeState } from "./use-player-runtime-state";

const flags = vi.hoisted(() => ({ native: true, cast: false }));
vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: () => flags.native,
}));
vi.mock("@/lib/cast-sender", () => ({ isCastSessionActive: () => flags.cast }));
vi.mock("@/lib/gapless-player", () => ({ initPlayer: () => ({}) }));
const mix: EngineMixState = {
  revision: "queue-a",
  executionId: 7,
  mode: "beatmatch",
  phase: "mixing",
  bassHandoff: true,
  outgoingTrackId: "a",
  incomingTrackId: "b",
};
function useScene(props: { castActive: boolean; remoteActive: boolean }) {
  const runtime = usePlayerRuntimeState();
  const available = useNativeMixAvailability({
    ...props,
    setAvailable: runtime.setNativeMixAvailable,
  });
  return {
    ...runtime,
    available,
    visibleMixState: available ? runtime.mixState : null,
  };
}
describe("native mix authority", () => {
  beforeEach(() => {
    flags.native = true;
    flags.cast = false;
    localStorage.clear();
  });
  it("clears on remote transfer and blocks delayed native samples from reappearing on return", () => {
    const { result, rerender } = renderHook(useScene, {
      initialProps: { castActive: false, remoteActive: false },
    });
    act(() => result.current.setMixState(mix));
    expect(result.current.visibleMixState).toEqual(mix);
    rerender({ castActive: false, remoteActive: true });
    expect(result.current.available).toBe(false);
    expect(result.current.mixState).toBeNull();
    act(() => result.current.setMixState(mix));
    rerender({ castActive: false, remoteActive: false });
    expect(result.current.visibleMixState).toBeNull();
    act(() => result.current.setMixState(mix));
    expect(result.current.visibleMixState).toEqual(mix);
  });
  it("clears for paused Cast sessions and native motor preference changes", () => {
    const { result, rerender } = renderHook(useScene, {
      initialProps: { castActive: false, remoteActive: false },
    });
    act(() => result.current.setMixState(mix));
    flags.cast = true;
    rerender({ castActive: true, remoteActive: false });
    expect(result.current.visibleMixState).toBeNull();
    act(() => result.current.setMixState(mix));
    flags.cast = false;
    rerender({ castActive: false, remoteActive: false });
    expect(result.current.mixState).toBeNull();
    act(() => result.current.setMixState(mix));
    flags.native = false;
    act(() =>
      window.dispatchEvent(new Event("crate:native-player-pref-changed")),
    );
    expect(result.current.available).toBe(false);
    expect(result.current.visibleMixState).toBeNull();
    flags.native = true;
    act(() =>
      window.dispatchEvent(new Event("crate:native-player-pref-changed")),
    );
    expect(result.current.available).toBe(true);
    expect(result.current.mixState).toBeNull();
  });
  it("preserves state identity for duplicate native readings without progress-driven updates", () => {
    const { result } = renderHook(useScene, {
      initialProps: { castActive: false, remoteActive: false },
    });
    act(() => result.current.setMixState(mix));
    const actual = result.current.mixState;
    act(() => result.current.setMixState({ ...mix }));
    expect(result.current.mixState).toBe(actual);
    act(() => result.current.setMixState({ ...mix, bassHandoff: false }));
    expect(result.current.mixState).not.toBe(actual);
    expect(result.current.mixState?.bassHandoff).toBe(false);
  });
  it("keeps web or older engines unknown and clears a queue replacement", () => {
    flags.native = false;
    const { result } = renderHook(useScene, {
      initialProps: { castActive: false, remoteActive: false },
    });
    act(() => result.current.setMixState(mix));
    expect(result.current.available).toBe(false);
    expect(result.current.mixState).toBeNull();
    flags.native = true;
    act(() =>
      window.dispatchEvent(new Event("crate:native-player-pref-changed")),
    );
    act(() => result.current.setMixState(mix));
    act(() =>
      result.current.commitQueue([{ id: "c", title: "C", artist: "Band" }]),
    );
    expect(result.current.mixState).toBeNull();
  });
});
