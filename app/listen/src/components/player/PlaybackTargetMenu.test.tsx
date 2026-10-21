import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  disconnectCastSessionMock,
  loadGroupsMock,
  onNativeOutputRouteChangedMock,
  selectTargetMock,
  stopCastSessionMock,
  toastInfoMock,
} = vi.hoisted(() => ({
  disconnectCastSessionMock: vi.fn(),
  loadGroupsMock: vi.fn(),
  onNativeOutputRouteChangedMock: vi.fn(),
  selectTargetMock: vi.fn(),
  stopCastSessionMock: vi.fn(),
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

vi.mock("@crate/ui/lib/notify", () => ({
  notify: {
    info: toastInfoMock,
  },
}));

vi.mock("@/lib/native-output-router", () => ({
  onNativeOutputRouteChanged: onNativeOutputRouteChangedMock,
}));

vi.mock("@/lib/cast-sender", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/cast-sender")>(
      "@/lib/cast-sender",
    );
  return {
    ...actual,
    disconnectCastSession: disconnectCastSessionMock,
    stopCastSession: stopCastSessionMock,
  };
});

import { PlaybackTargetMenu } from "@/components/player/PlaybackTargetMenu";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

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
            name: "Crate on Chrome",
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
    disconnectCastSessionMock.mockResolvedValue({ ok: true });
    stopCastSessionMock.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens the unified output menu with local and Crate targets", async () => {
    renderWithListenProviders(<PlaybackTargetMenu />);

    const outputButton = screen.getByRole("button", { name: "Output" });
    fireEvent.click(outputButton);

    expect(await screen.findByText("Crate on Chrome")).toBeVisible();
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
            name: "Crate on Chrome",
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

    renderWithListenProviders(<PlaybackTargetMenu />);

    fireEvent.click(screen.getByRole("button", { name: "Output" }));

    expect(await screen.findByText("Desktop")).toBeVisible();
    expect(screen.getByText("Playing through Crate Connect")).toBeVisible();
    expect(screen.getByText("Active")).toBeVisible();
  });

  it("refreshes output state when the Cast session changes", async () => {
    renderWithListenProviders(<PlaybackTargetMenu />);

    await waitFor(() => expect(loadGroupsMock).toHaveBeenCalled());
    loadGroupsMock.mockClear();

    window.dispatchEvent(new Event("crate:cast-session-changed"));

    await waitFor(() => expect(loadGroupsMock).toHaveBeenCalledTimes(1));
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

    renderWithListenProviders(
      <PlaybackTargetMenu targetContext={targetContext} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Output" }));
    const localRow = (await screen.findByText("Crate on Chrome")).closest(
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

  it("localizes the output menu chrome", async () => {
    renderWithListenProviders(<PlaybackTargetMenu />, { locale: "es" });

    fireEvent.click(screen.getByRole("button", { name: "Salida" }));

    expect(
      await screen.findByRole("menu", { name: "Salidas de audio" }),
    ).toBeVisible();
    expect(screen.getByText("Salida")).toBeVisible();
    expect(screen.getByText("Activo")).toBeVisible();
    expect(screen.getByText("No disponible")).toBeVisible();
  });

  it("offers separate disconnect and stop actions for active Cast", async () => {
    loadGroupsMock.mockResolvedValue([
      {
        providerId: "google-cast",
        label: "Cast",
        targets: [
          {
            id: "google-cast:default",
            providerId: "google-cast",
            kind: "google-cast",
            name: "Living room TV",
            subtitle: "Playing on Google Cast",
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

    renderWithListenProviders(<PlaybackTargetMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Output" }));

    fireEvent.click(
      await screen.findByRole("menuitem", { name: /^Disconnect/ }),
    );
    await waitFor(() =>
      expect(disconnectCastSessionMock).toHaveBeenCalledOnce(),
    );
    expect(stopCastSessionMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Output" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /^Stop casting/ }),
    );
    await waitFor(() => expect(stopCastSessionMock).toHaveBeenCalledOnce());
  });
  it("shows discovery failure with retry instead of empty", async () => {
    loadGroupsMock.mockRejectedValue(new Error("network"));
    renderWithListenProviders(<PlaybackTargetMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Output" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not load your outputs",
    );
    loadGroupsMock.mockResolvedValue([]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("dialog", { name: "Output targets" }),
    ).toBeVisible();
  });

  it("blocks duplicate transfers and recovers from rejected selection", async () => {
    let rejectTransfer: (reason: Error) => void = () => {};
    selectTargetMock.mockReturnValue(
      new Promise((_, reject) => {
        rejectTransfer = reject;
      }),
    );
    renderWithListenProviders(<PlaybackTargetMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Output" }));
    const row = await screen.findByRole("menuitemradio", {
      name: /Crate on Chrome/,
    });
    fireEvent.click(row);
    fireEvent.click(row);
    expect(selectTargetMock).toHaveBeenCalledOnce();
    expect(row).toBeDisabled();
    rejectTransfer(new Error("internal transport details"));
    await waitFor(() => expect(row).not.toBeDisabled());
    expect(
      screen.getByRole("dialog", { name: "Output targets" }),
    ).toBeVisible();
    expect(toastInfoMock).toHaveBeenCalledWith("Output target is unavailable.");
  });
});
