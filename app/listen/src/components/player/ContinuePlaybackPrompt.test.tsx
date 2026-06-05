import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchCrateConnectPreferencesMock,
  fetchResumeCandidateMock,
  transferPlaybackToDeviceMock,
} = vi.hoisted(() => ({
  fetchCrateConnectPreferencesMock: vi.fn(),
  fetchResumeCandidateMock: vi.fn(),
  transferPlaybackToDeviceMock: vi.fn(),
}));

vi.mock("@/lib/remote-playback-state", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/remote-playback-state")
  >("@/lib/remote-playback-state");
  return {
    ...actual,
    fetchResumeCandidate: fetchResumeCandidateMock,
  };
});

vi.mock("@/lib/crate-connect", async () => {
  const actual = await vi.importActual<typeof import("@/lib/crate-connect")>(
    "@/lib/crate-connect",
  );
  return {
    ...actual,
    fetchCrateConnectPreferences: fetchCrateConnectPreferencesMock,
    isCrateConnectEnabled: vi.fn(() => true),
    transferPlaybackToDevice: transferPlaybackToDeviceMock,
  };
});

import { ContinuePlaybackPrompt } from "@/components/player/ContinuePlaybackPrompt";
import { STORAGE_KEY } from "@/contexts/player-utils";
import { renderWithListenProviders } from "@/test/render-with-listen-providers";

describe("ContinuePlaybackPrompt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchCrateConnectPreferencesMock.mockResolvedValue({ enabled: true });
    transferPlaybackToDeviceMock.mockResolvedValue(undefined);
    vi.setSystemTime(new Date("2026-05-25T10:01:00.000Z"));
    localStorage.setItem("listen-device-fingerprint", "phone");
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        queue: [{ id: "local", title: "Local", artist: "Local Artist" }],
        currentIndex: 0,
        currentTime: 0,
        wasPlaying: false,
        savedAt: "2026-05-25T09:59:00.000Z",
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("lets the user explicitly continue recent remote playback here", async () => {
    fetchResumeCandidateMock.mockResolvedValueOnce({
      candidate: {
        device_id: "desktop",
        device_label: "Desktop",
        status: "playing",
        title: "Remote Track",
        artist: "Remote Artist",
        album: "Remote Album",
        position_ms: 42000,
        duration_ms: 180000,
        current_index: 0,
        queue: [
          {
            track_id: 44,
            title: "Remote Track",
            artist: "Remote Artist",
            album: "Remote Album",
            duration: 180,
          },
        ],
        play_source: { type: "album", name: "Remote Album", id: 9 },
        repeat_mode: "off",
        shuffle: false,
        updated_at: "2026-05-25T10:00:30.000Z",
      },
    });
    const playAll = vi.fn();
    const seek = vi.fn();

    renderWithListenProviders(<ContinuePlaybackPrompt />, {
      playerActions: { playAll, seek },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Playing on Desktop")).toBeVisible();
    expect(screen.getByText(/Remote Artist - Remote Track/)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Play here" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(transferPlaybackToDeviceMock).toHaveBeenCalledWith("phone", {
      sourceDeviceId: "desktop",
      startPlaying: true,
    });
    expect(playAll).not.toHaveBeenCalled();
    expect(seek).not.toHaveBeenCalled();
    expect(screen.queryByText("Playing on Desktop")).not.toBeInTheDocument();
  });

  it("requests a Crate Connect v2 takeover without calling legacy device transfer", async () => {
    const requestTransfer = vi.fn(() => true);

    renderWithListenProviders(<ContinuePlaybackPrompt />, {
      playerActions: {
        connect: {
          activeInstanceId: "desktop-tab",
          connectedInstances: [
            {
              app_platform: "listen-web",
              device_label: "Crate on Safari",
              device_type: "web",
              instance_id: "desktop-tab",
            },
          ],
          enabled: true,
          isRemoteActive: true,
          playbackInstanceId: "phone-tab",
          remoteState: {
            device_id: "desktop",
            device_label: "Desktop",
            status: "playing",
            title: "Remote Track",
            artist: "Remote Artist",
            album: "Remote Album",
            position_ms: 42000,
            duration_ms: 180000,
            current_index: 0,
            queue: [
              {
                track_id: 44,
                title: "Remote Track",
                artist: "Remote Artist",
                album: "Remote Album",
                duration: 180,
              },
            ],
            repeat_mode: "off",
            shuffle: false,
            updated_at: "2026-05-25T10:00:30.000Z",
          },
          requestTransfer,
          sendRemoteCommand: vi.fn(() => false),
          serverClockOffsetMs: 0,
          transport: "ws",
        },
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Playing on Crate on Safari")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Play here" }));

    expect(requestTransfer).toHaveBeenCalledWith("phone-tab");
    expect(transferPlaybackToDeviceMock).not.toHaveBeenCalled();
    expect(fetchResumeCandidateMock).not.toHaveBeenCalled();
    expect(
      screen.queryByText("Playing on Crate on Safari"),
    ).not.toBeInTheDocument();
  });

  it("does not prompt on the current Crate Connect v2 owner", async () => {
    renderWithListenProviders(<ContinuePlaybackPrompt />, {
      playerActions: {
        connect: {
          activeInstanceId: "phone-tab",
          connectedInstances: [
            {
              app_platform: "listen-web",
              device_label: "Crate on Chrome",
              device_type: "web",
              instance_id: "phone-tab",
            },
          ],
          enabled: true,
          isRemoteActive: true,
          playbackInstanceId: "phone-tab",
          remoteState: {
            device_id: "phone",
            device_label: "Web (Listen)",
            status: "playing",
            title: "Local Track",
            artist: "Local Artist",
            album: "Local Album",
            position_ms: 42000,
            duration_ms: 180000,
            current_index: 0,
            queue: [
              {
                track_id: 44,
                title: "Local Track",
                artist: "Local Artist",
                album: "Local Album",
                duration: 180,
              },
            ],
            repeat_mode: "off",
            shuffle: false,
            updated_at: "2026-05-25T10:00:30.000Z",
          },
          requestTransfer: vi.fn(() => true),
          sendRemoteCommand: vi.fn(() => false),
          serverClockOffsetMs: 0,
          transport: "ws",
        },
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText(/Playing on/)).not.toBeInTheDocument();
    expect(fetchResumeCandidateMock).not.toHaveBeenCalled();
  });

  it("does not prompt for a stale Crate Connect v2 owner that is not connected", async () => {
    renderWithListenProviders(<ContinuePlaybackPrompt />, {
      playerActions: {
        connect: {
          activeInstanceId: "old-tab",
          connectedInstances: [
            {
              app_platform: "listen-web",
              device_label: "Crate on Chrome",
              device_type: "web",
              instance_id: "phone-tab",
            },
          ],
          enabled: true,
          isRemoteActive: true,
          playbackInstanceId: "phone-tab",
          remoteState: {
            device_id: "old-device",
            device_label: "Web (Listen)",
            status: "playing",
            title: "Remote Track",
            artist: "Remote Artist",
            album: "Remote Album",
            position_ms: 42000,
            duration_ms: 180000,
            current_index: 0,
            queue: [
              {
                track_id: 44,
                title: "Remote Track",
                artist: "Remote Artist",
                album: "Remote Album",
                duration: 180,
              },
            ],
            repeat_mode: "off",
            shuffle: false,
            updated_at: "2026-05-25T10:00:30.000Z",
          },
          requestTransfer: vi.fn(() => true),
          sendRemoteCommand: vi.fn(() => false),
          serverClockOffsetMs: 0,
          transport: "ws",
        },
      },
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText(/Playing on/)).not.toBeInTheDocument();
    expect(fetchResumeCandidateMock).not.toHaveBeenCalled();
  });
});
