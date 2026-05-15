import { describe, expect, it, beforeEach, vi } from "vitest";
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
  setPlaybackDeliveryPolicyPreference,
  getMobileEnhancedAudioPreference,
  setMobileEnhancedAudioPreference,
  PLAYER_PLAYBACK_PREFS_EVENT,
} from "./player-playback-prefs";

beforeEach(() => {
  localStorage.clear();
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
  it("defaults to original on desktop", () => {
    expect(getPlaybackDeliveryPolicyPreference()).toBe("original");
  });

  it("round-trips balanced", () => {
    setPlaybackDeliveryPolicyPreference("balanced");
    expect(getPlaybackDeliveryPolicyPreference()).toBe("balanced");
  });

  it("ignores invalid values", () => {
    localStorage.setItem("listen-player-delivery-policy", "invalid");
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
});
