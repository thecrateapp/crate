import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SmartMixSettings } from "@/components/settings/SmartMixSettings";
import {
  getCrossfadeDurationPreference,
  getNativeBassHandoffPreference,
  getNativeBeatmatchPreference,
  getNativeSmartMixEnabledPreference,
  registerNativeMixRuntime,
} from "@/lib/player-playback-prefs";
import { setSmartMixCapabilities } from "@/lib/smart-mix";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

const runtime = { androidNative: true };
registerNativeMixRuntime(() => runtime.androidNative);

const ENABLED = {
  available: true,
  androidNativeCrossfade: true,
  androidBeatmatch: true,
  androidBassHandoff: false,
  androidLongBeatmatch: false,
  plannerVersion: "smart-mix-v2",
};
const DISABLED = {
  available: false,
  androidNativeCrossfade: false,
  androidBeatmatch: false,
  androidBassHandoff: false,
  androidLongBeatmatch: false,
  plannerVersion: null,
};

describe("SmartMixSettings", () => {
  beforeEach(() => {
    runtime.androidNative = true;
    localStorage.clear();
    setSmartMixCapabilities(ENABLED);
  });

  afterEach(() => {
    setSmartMixCapabilities(DISABLED);
  });

  it("shows the Smart Mix switch and duration on Android native", () => {
    renderWithListenProviders(<SmartMixSettings />);

    expect(screen.getByRole("switch", { name: "Smart Mix" })).toBeChecked();
    expect(
      screen.getByRole("slider", { name: "Maximum transition" }),
    ).toHaveValue("6");
    expect(screen.getByRole("switch", { name: "Beatmatch" })).not.toBeChecked();
    expect(
      screen.queryByRole("switch", { name: "Bass swap" }),
    ).not.toBeInTheDocument();
  });

  it("hides beatmatch when the server does not offer it", () => {
    setSmartMixCapabilities({ ...ENABLED, androidBeatmatch: false });

    renderWithListenProviders(<SmartMixSettings />);

    expect(
      screen.queryByRole("switch", { name: "Beatmatch" }),
    ).not.toBeInTheDocument();
  });

  it("enables the bass swap only after opting into beatmatch", async () => {
    const user = userEvent.setup();
    setSmartMixCapabilities({ ...ENABLED, androidBassHandoff: true });
    renderWithListenProviders(<SmartMixSettings />);

    const bassSwap = screen.getByRole("switch", { name: "Bass swap" });
    expect(bassSwap).toBeDisabled();

    await user.click(screen.getByRole("switch", { name: "Beatmatch" }));
    expect(getNativeBeatmatchPreference()).toBe(true);
    expect(bassSwap).toBeEnabled();

    await user.click(bassSwap);
    expect(getNativeBassHandoffPreference()).toBe(true);
  });

  it("persists an opt-out and disables the duration", async () => {
    const user = userEvent.setup();
    renderWithListenProviders(<SmartMixSettings />);

    await user.click(screen.getByRole("switch", { name: "Smart Mix" }));

    expect(getNativeSmartMixEnabledPreference()).toBe(false);
    expect(getCrossfadeDurationPreference()).toBe(0);
    expect(
      screen.getByRole("slider", { name: "Maximum transition" }),
    ).toBeDisabled();
  });

  it("explains when the server has not enabled Smart Mix", () => {
    setSmartMixCapabilities(DISABLED);

    renderWithListenProviders(<SmartMixSettings />);

    expect(
      screen.getByText("Smart Mix is not enabled on this server."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("follows capability changes while open", () => {
    setSmartMixCapabilities(DISABLED);
    renderWithListenProviders(<SmartMixSettings />);

    act(() => setSmartMixCapabilities(ENABLED));

    expect(screen.getByRole("switch", { name: "Smart Mix" })).toBeChecked();
  });

  it("renders nothing outside the Android native player", () => {
    runtime.androidNative = false;

    const { container } = renderWithListenProviders(<SmartMixSettings />);

    expect(container).toBeEmptyDOMElement();
  });
});
