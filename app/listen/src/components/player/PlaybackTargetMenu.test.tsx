import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  loadGroupsMock,
  onNativeOutputRouteChangedMock,
  selectTargetMock,
  toastInfoMock,
} = vi.hoisted(() => ({
  loadGroupsMock: vi.fn(),
  onNativeOutputRouteChangedMock: vi.fn(),
  selectTargetMock: vi.fn(),
  toastInfoMock: vi.fn(),
}));

vi.mock("@/lib/playback-targets", async () => {
  const actual = await vi.importActual<typeof import("@/lib/playback-targets")>(
    "@/lib/playback-targets",
  );
  return {
    ...actual,
    loadPlaybackTargetGroups: loadGroupsMock,
    selectPlaybackTarget: selectTargetMock,
  };
});

vi.mock("sonner", () => ({
  toast: {
    info: toastInfoMock,
  },
}));

vi.mock("@/lib/native-output-router", () => ({
  onNativeOutputRouteChanged: onNativeOutputRouteChangedMock,
}));

import { PlaybackTargetMenu } from "@/components/player/PlaybackTargetMenu";

describe("PlaybackTargetMenu", () => {
  beforeEach(() => {
    onNativeOutputRouteChangedMock.mockResolvedValue(() => {});
    loadGroupsMock.mockResolvedValue([
      {
        providerId: "local",
        label: "This device",
        targets: [
          {
            id: "local:current",
            providerId: "local",
            kind: "local",
            name: "Web (Listen)",
            subtitle: "System-selected output",
            active: true,
            available: true,
            capabilities: {
              canPlay: true,
              canSeek: true,
              canSetVolume: true,
            },
          },
        ],
      },
      {
        providerId: "crate-connect",
        label: "Crate devices",
        targets: [
          {
            id: "crate:desktop",
            providerId: "crate-connect",
            kind: "crate-device",
            name: "Desktop",
            subtitle: "Active Crate device",
            active: false,
            available: false,
            unavailableReason: "Crate Connect transfer is coming later.",
            capabilities: {
              canPlay: true,
              canSeek: false,
              canSetVolume: true,
            },
          },
        ],
      },
    ]);
    selectTargetMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens the unified output menu with local and Crate targets", async () => {
    render(<PlaybackTargetMenu />);

    fireEvent.click(screen.getByRole("button", { name: "Output" }));

    expect(await screen.findByText("Web (Listen)")).toBeVisible();
    expect(screen.getByText("System-selected output")).toBeVisible();
    expect(screen.getByText("Desktop")).toBeVisible();
    expect(screen.getByText("Unavailable")).toBeVisible();
  });

  it("surfaces the active remote Connect device", async () => {
    loadGroupsMock.mockResolvedValue([
      {
        providerId: "local",
        label: "This device",
        targets: [
          {
            id: "local:current",
            providerId: "local",
            kind: "local",
            name: "Web (Listen)",
            subtitle: "Available on this device",
            active: false,
            available: true,
            capabilities: {
              canPlay: true,
              canSeek: true,
              canSetVolume: true,
            },
          },
        ],
      },
      {
        providerId: "crate-connect",
        label: "Crate devices",
        targets: [
          {
            id: "crate:desktop",
            providerId: "crate-connect",
            kind: "crate-device",
            name: "Desktop",
            subtitle: "Playing through Crate Connect",
            active: true,
            available: true,
            capabilities: {
              canPlay: true,
              canSeek: true,
              canSetVolume: true,
            },
          },
        ],
      },
    ]);

    render(<PlaybackTargetMenu />);

    fireEvent.click(screen.getByRole("button", { name: "Output" }));

    expect(await screen.findByText("Desktop")).toBeVisible();
    expect(screen.getByText("Playing through Crate Connect")).toBeVisible();
    expect(screen.getByText("Active")).toBeVisible();
  });

  it("delegates available targets and explains unavailable targets", async () => {
    const targetContext = {
      currentTrack: {
        id: "track-1",
        title: "Track",
        artist: "Artist",
        libraryTrackId: 7,
      },
      currentTime: 4,
    };

    render(<PlaybackTargetMenu targetContext={targetContext} />);

    fireEvent.click(screen.getByRole("button", { name: "Output" }));
    const localRow = (await screen.findByText("Web (Listen)")).closest(
      "button",
    );
    expect(localRow).not.toBeNull();
    fireEvent.click(localRow!);

    await waitFor(() => expect(selectTargetMock).toHaveBeenCalledTimes(1));
    expect(loadGroupsMock).toHaveBeenCalledWith(targetContext);
    expect(selectTargetMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "local:current" }),
      targetContext,
    );

    fireEvent.click(screen.getByRole("button", { name: "Output" }));
    const crateRow = (await screen.findByText("Desktop")).closest("button");
    expect(crateRow).not.toBeNull();
    fireEvent.click(crateRow!);

    expect(toastInfoMock).toHaveBeenCalledWith(
      "Crate Connect transfer is coming later.",
    );
  });
});
