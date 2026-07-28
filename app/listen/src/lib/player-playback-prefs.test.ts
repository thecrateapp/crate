import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import {
  getCrossfadeDurationPreference,
  setCrossfadeDurationPreference,
  getSmartCrossfadePreference,
  setSmartCrossfadePreference,
  getInfinitePlaybackPreference,
  setInfinitePlaybackPreference,
  getSmartPlaylistSuggestionsPreference,
  setSmartPlaylistSuggestionsPreference,
  getSmartPlaylistSuggestionsCadencePreference,
  setSmartPlaylistSuggestionsCadencePreference,
  getPlaybackDeliveryPolicyPreference,
  getEffectivePlaybackDeliveryPolicy,
  setPlaybackDeliveryPolicyPreference,
  getMobileEnhancedAudioPreference,
  setMobileEnhancedAudioPreference,
  PLAYER_PLAYBACK_PREFS_EVENT,
} from "./player-playback-prefs";

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1024,
  });
});

afterEach(() => {
  Object.defineProperty(navigator, "connection", {
    configurable: true,
    value: undefined,
  });
});

describe("crossfade", () => {
  it("defaults to 0", () => {
    expect(getCrossfadeDurationPreference()).toBe(0);
  });

  it("reads stored value", () => {
    localStorage.setItem("listen-player-crossfade-seconds", "3.5");
    expect(getCrossfadeDurationPreference()).toBe(3.5);
  });

  it("caps at 12", () => {
    setCrossfadeDurationPreference(20);
    expect(getCrossfadeDurationPreference()).toBe(12);
  });

  it("floors at 0", () => {
    setCrossfadeDurationPreference(-1);
    expect(getCrossfadeDurationPreference()).toBe(0);
  });

  it("dispatches event on set", () => {
    const handler = vi.fn();
    window.addEventListener(PLAYER_PLAYBACK_PREFS_EVENT, handler);
    setCrossfadeDurationPreference(4);
    expect(handler).toHaveBeenCalled();
    window.removeEventListener(PLAYER_PLAYBACK_PREFS_EVENT, handler);
  });

  it("ignores and clears a legacy crossfade value on mobile", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    localStorage.setItem("listen-player-crossfade-seconds", "4");

    expect(getCrossfadeDurationPreference()).toBe(0);
    expect(localStorage.getItem("listen-player-crossfade-seconds")).toBeNull();
  });

  it("cannot enable crossfade on mobile", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    const handler = vi.fn();
    window.addEventListener(PLAYER_PLAYBACK_PREFS_EVENT, handler);

    setCrossfadeDurationPreference(5);

    expect(getCrossfadeDurationPreference()).toBe(0);
    expect(localStorage.getItem("listen-player-crossfade-seconds")).toBeNull();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { crossfadeSeconds: 0 },
      }),
    );
    window.removeEventListener(PLAYER_PLAYBACK_PREFS_EVENT, handler);
  });
});

describe("smart crossfade", () => {
  it("defaults to true", () => {
    expect(getSmartCrossfadePreference()).toBe(true);
  });

  it("reads false", () => {
    localStorage.setItem("listen-player-smart-crossfade", "false");
    expect(getSmartCrossfadePreference()).toBe(false);
  });

  it("round-trips", () => {
    setSmartCrossfadePreference(false);
    expect(getSmartCrossfadePreference()).toBe(false);
  });

  it("cannot enable smart transitions on mobile", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    localStorage.setItem("listen-player-smart-crossfade", "true");

    expect(getSmartCrossfadePreference()).toBe(false);
    expect(localStorage.getItem("listen-player-smart-crossfade")).toBeNull();

    setSmartCrossfadePreference(true);

    expect(getSmartCrossfadePreference()).toBe(false);
    expect(localStorage.getItem("listen-player-smart-crossfade")).toBeNull();
  });
});

describe("infinite playback", () => {
  it("defaults to true", () => {
    expect(getInfinitePlaybackPreference()).toBe(true);
  });

  it("reads false", () => {
    localStorage.setItem("listen-player-infinite-playback", "false");
    expect(getInfinitePlaybackPreference()).toBe(false);
  });

  it("round-trips", () => {
    setInfinitePlaybackPreference(false);
    expect(getInfinitePlaybackPreference()).toBe(false);
  });
});

describe("smart playlist suggestions", () => {
  it("defaults to false", () => {
    expect(getSmartPlaylistSuggestionsPreference()).toBe(false);
  });

  it("reads true", () => {
    localStorage.setItem("listen-player-smart-playlist-suggestions", "true");
    expect(getSmartPlaylistSuggestionsPreference()).toBe(true);
  });

  it("round-trips", () => {
    setSmartPlaylistSuggestionsPreference(true);
    expect(getSmartPlaylistSuggestionsPreference()).toBe(true);
  });
});

describe("smart playlist cadence", () => {
  it("defaults to 5", () => {
    expect(getSmartPlaylistSuggestionsCadencePreference()).toBe(5);
  });

  it("reads stored value", () => {
    localStorage.setItem(
      "listen-player-smart-playlist-suggestions-cadence",
      "3",
    );
    expect(getSmartPlaylistSuggestionsCadencePreference()).toBe(3);
  });

  it("caps at 10", () => {
    setSmartPlaylistSuggestionsCadencePreference(20);
    expect(getSmartPlaylistSuggestionsCadencePreference()).toBe(10);
  });

  it("floors at 2", () => {
    setSmartPlaylistSuggestionsCadencePreference(1);
    expect(getSmartPlaylistSuggestionsCadencePreference()).toBe(2);
  });
});

describe("playback delivery policy", () => {
  it("defaults to auto while retaining the desktop original policy", () => {
    expect(getPlaybackDeliveryPolicyPreference()).toBe("auto");
    expect(getEffectivePlaybackDeliveryPolicy()).toBe("original");
  });

  it("round-trips balanced", () => {
    setPlaybackDeliveryPolicyPreference("balanced");
    expect(getPlaybackDeliveryPolicyPreference()).toBe("balanced");
  });

  it("ignores invalid values", () => {
    localStorage.setItem("listen-player-delivery-policy", "invalid");
    expect(getPlaybackDeliveryPolicyPreference()).toBe("auto");
  });

  it("uses data saver automatically on a constrained connection", () => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { effectiveType: "slow-2g", downlink: 0.5, rtt: 800 },
    });

    expect(getPlaybackDeliveryPolicyPreference()).toBe("auto");
    expect(getEffectivePlaybackDeliveryPolicy()).toBe("data_saver");
  });

  it("preserves an explicit quality preference over connection hints", () => {
    Object.defineProperty(navigator, "connection", {
      configurable: true,
      value: { effectiveType: "slow-2g", downlink: 0.5, rtt: 800 },
    });
    setPlaybackDeliveryPolicyPreference("original");

    expect(getPlaybackDeliveryPolicyPreference()).toBe("original");
  });
});

describe("mobile enhanced audio", () => {
  it("defaults to false", () => {
    expect(getMobileEnhancedAudioPreference()).toBe(false);
  });

  it("reads true", () => {
    localStorage.setItem("listen-player-mobile-enhanced-audio", "true");
    expect(getMobileEnhancedAudioPreference()).toBe(true);
  });

  it("round-trips", () => {
    setMobileEnhancedAudioPreference(true);
    expect(getMobileEnhancedAudioPreference()).toBe(true);
  });

  it("ignores and clears the experimental pipeline on mobile", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    localStorage.setItem("listen-player-mobile-enhanced-audio", "true");

    expect(getMobileEnhancedAudioPreference()).toBe(false);
    expect(
      localStorage.getItem("listen-player-mobile-enhanced-audio"),
    ).toBeNull();
  });
});
