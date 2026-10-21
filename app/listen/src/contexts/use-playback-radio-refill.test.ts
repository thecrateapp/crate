import { afterEach, describe, expect, it, vi } from "vitest";

const nativeActive = vi.hoisted(() => ({ value: true }));
vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: () => nativeActive.value,
}));

import { nativeOwnsBackgroundRefill } from "./use-playback-radio-refill";

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
}

describe("nativeOwnsBackgroundRefill", () => {
  afterEach(() => {
    setVisibility("visible");
    nativeActive.value = true;
  });

  it("hands refill to the native service only while the app is hidden", () => {
    setVisibility("hidden");
    expect(nativeOwnsBackgroundRefill()).toBe(true);

    setVisibility("visible");
    expect(nativeOwnsBackgroundRefill()).toBe(false);

    setVisibility("hidden");
    nativeActive.value = false;
    expect(nativeOwnsBackgroundRefill()).toBe(false);
  });
});
