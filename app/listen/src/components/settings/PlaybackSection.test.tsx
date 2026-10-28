import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";
import {
  getEqualizerEnabled,
  setEqualizerEnabled,
} from "@/lib/equalizer-prefs";
import { getCrossfadeDurationPreference } from "@/lib/player-playback-prefs";
import { PlaybackSection } from "./PlaybackSection";
import { EqualizerPanel } from "../player/EqualizerPanel";

const runtime = vi.hoisted(() => ({ android: false }));
vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: () => runtime.android,
}));
beforeEach(() => {
  localStorage.clear();
  runtime.android = false;
});
afterEach(() => {
  localStorage.clear();
});

it("keeps Settings synchronized with the actual panel power without resetting other preferences", () => {
  setEqualizerEnabled(true);
  renderWithListenProviders(
    <>
      <PlaybackSection />
      <EqualizerPanel />
    </>,
  );
  const power = screen.getByRole("switch", { name: "Equalizer" });
  const crossfade = screen.getByRole("slider", { name: "Crossfade" });
  fireEvent.change(crossfade, { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "On" }));
  expect(power).not.toBeChecked();
  expect(crossfade).toHaveValue("5");
  expect(getCrossfadeDurationPreference()).toBe(5);
  fireEvent.click(power);
  expect(screen.getByRole("button", { name: "On" })).toBeInTheDocument();
  expect(getEqualizerEnabled()).toBe(true);
});

it("follows external storage changes while mounted", () => {
  setEqualizerEnabled(true);
  renderWithListenProviders(<PlaybackSection />);
  localStorage.setItem("listen-eq-enabled", "false");
  act(() =>
    window.dispatchEvent(
      new StorageEvent("storage", { key: "listen-eq-enabled" }),
    ),
  );
  expect(screen.getByRole("switch", { name: "Equalizer" })).not.toBeChecked();
});

it("retains the native Android default when no power preference exists", () => {
  runtime.android = true;
  renderWithListenProviders(<PlaybackSection />);
  expect(screen.getByRole("switch", { name: "Equalizer" })).toBeChecked();
  act(() => setEqualizerEnabled(false));
  expect(screen.getByRole("switch", { name: "Equalizer" })).not.toBeChecked();
});
