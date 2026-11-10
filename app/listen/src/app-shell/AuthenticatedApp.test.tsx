import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticatedApp } from "@/app-shell/AuthenticatedApp";
import {
  clearMediaAccessTickets,
  setMediaAccessTickets,
} from "@/lib/media-access";

const shellRender = vi.hoisted(() => vi.fn());
const apiMock = vi.hoisted(() => vi.fn());
const setSmartMixCapabilities = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

vi.mock("@/lib/android-native-engine", () => ({
  isAndroidNativePlayerAvailable: () => true,
  setAndroidNativeSmartMixCapabilities: setSmartMixCapabilities,
}));

vi.mock("@/app-shell/AppProviders", () => ({
  AppProviders: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@/components/layout/Shell", () => ({
  Shell: () => {
    shellRender();
    return <div>Shell</div>;
  },
}));

vi.mock("@/components/share/ShareSheet", () => ({
  ShareSheetHost: () => null,
}));

vi.mock("@/app-shell/TimezoneAutodetect", () => ({
  TimezoneAutodetect: () => null,
}));

vi.mock("@/components/dev/TauriDevLogPanel", () => ({
  TauriDevLogPanel: () => null,
}));

describe("AuthenticatedApp", () => {
  beforeEach(() => {
    clearMediaAccessTickets();
    shellRender.mockClear();
    apiMock.mockReset();
    apiMock.mockResolvedValue({
      smart_mix: {
        available: false,
        planner_version: null,
        android_native_crossfade: false,
        android_beatmatch: false,
      },
    });
    setSmartMixCapabilities.mockReset();
  });

  it("does not rebuild the app shell after ticket refresh", () => {
    render(<AuthenticatedApp />);
    expect(shellRender).toHaveBeenCalledTimes(1);

    act(() => {
      setMediaAccessTickets([], "server-a");
    });

    expect(shellRender).toHaveBeenCalledTimes(1);
  });

  it("loads native Smart Mix capabilities without blocking the shell", async () => {
    apiMock.mockResolvedValue({
      smart_mix: {
        available: true,
        planner_version: "smart-mix-v2",
        android_native_crossfade: true,
        android_beatmatch: false,
      },
    });

    render(<AuthenticatedApp />);

    expect(shellRender).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith("/api/capabilities");
    });
    expect(setSmartMixCapabilities).toHaveBeenCalledWith({
      available: true,
      androidNativeCrossfade: true,
      androidBeatmatch: false,
      androidBassHandoff: false,
      androidLongBeatmatch: false,
      plannerVersion: "smart-mix-v2",
      // An older server lists no planners and recommends none for Listen.
      plannerVersions: [],
      listenPlannerVersion: null,
    });
  });

  it("reads the planners and the one recommended for Listen", async () => {
    apiMock.mockResolvedValue({
      smart_mix: {
        available: true,
        planner_version: "smart-mix-v2",
        planner_versions: ["smart-mix-v2", "smart-mix-v3"],
        listen_planner_version: "smart-mix-v3",
        android_native_crossfade: true,
        android_beatmatch: true,
      },
    });

    render(<AuthenticatedApp />);

    await waitFor(() => {
      expect(setSmartMixCapabilities).toHaveBeenCalledWith(
        expect.objectContaining({
          plannerVersion: "smart-mix-v2",
          plannerVersions: ["smart-mix-v2", "smart-mix-v3"],
          listenPlannerVersion: "smart-mix-v3",
        }),
      );
    });
  });

  it("has no planners when the capabilities cannot be read", async () => {
    apiMock.mockRejectedValue(new Error("offline"));

    render(<AuthenticatedApp />);

    await waitFor(() => {
      expect(setSmartMixCapabilities).toHaveBeenCalledWith(
        expect.objectContaining({
          available: false,
          plannerVersions: [],
          listenPlannerVersion: null,
        }),
      );
    });
  });

  it("reads the long beatmatch capability a newer server advertises", async () => {
    apiMock.mockResolvedValue({
      smart_mix: {
        available: true,
        planner_version: "smart-mix-v2",
        android_native_crossfade: true,
        android_beatmatch: true,
        android_long_beatmatch: true,
      },
    });

    render(<AuthenticatedApp />);

    await waitFor(() => {
      expect(setSmartMixCapabilities).toHaveBeenCalledWith(
        expect.objectContaining({ androidLongBeatmatch: true }),
      );
    });
  });
});
