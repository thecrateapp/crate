import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SmartMixSettings } from "@/components/settings/SmartMixSettings";
import {
  getCrossfadeDurationPreference,
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
  plannerVersion: "smart-mix-v2",
};
const DISABLED = {
  available: false,
  androidNativeCrossfade: false,
  androidBeatmatch: false,
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
    expect(screen.queryByText(/beatmatch/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/bass/i)).not.toBeInTheDocument();
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
