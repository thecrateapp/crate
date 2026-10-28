import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/gapless-player", () => ({ initPlayer: () => ({}) }));
vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: () => false,
}));
vi.mock("@/lib/cast-sender", () => ({ isCastSessionActive: () => false }));

import { usePlayerRuntimeState } from "./use-player-runtime-state";

it("publishes the selected source synchronously before a rendering update", () => {
  const { result } = renderHook(() => usePlayerRuntimeState());
  act(() => {
    result.current.setPlaySource({ type: "album", name: "B" });
    expect(result.current.playSourceRef.current?.name).toBe("B");
    result.current.setPlaySource((previous) => ({ ...previous!, name: "C" }));
    expect(result.current.playSourceRef.current?.name).toBe("C");
  });
  expect(result.current.playSource?.name).toBe("C");
  expect(result.current.queueReadinessRef.current.ready).toBe(true);
});
