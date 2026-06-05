import { describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  apiSseUrl: vi.fn((path: string) => path),
  apiUrl: vi.fn((path: string) => `https://api.test${path}`),
}));

vi.mock("@/lib/listen-device", () => ({
  getListenDeviceId: vi.fn(() => "device-1"),
}));

import {
  connectPlayerStateToRemotePlaybackState,
  connectWebSocketUrl,
  fetchConnectWsTicket,
  generatePlaybackInstanceId,
  isCrateConnectEnabled,
} from "@/lib/crate-connect";

describe("Crate Connect v2 client primitives", () => {
  it("starts disabled until the user preference enables it", () => {
    expect(isCrateConnectEnabled()).toBe(false);
  });

  it("creates stable-looking per-mount playback instance ids", () => {
    const first = generatePlaybackInstanceId();
    const second = generatePlaybackInstanceId();

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it("requests a short-lived WebSocket ticket for the current device", async () => {
    apiMock.mockResolvedValueOnce({
      ticket: "v2.ticket",
      expires_at: "2026-05-31T10:01:00Z",
      ws_url: "/api/me/connect/ws?ticket=v2.ticket",
    });

    const ticket = await fetchConnectWsTicket();

    expect(apiMock).toHaveBeenCalledWith("/api/me/connect/ws-ticket", "POST", {
      device_id: "device-1",
    });
    expect(ticket.ticket).toBe("v2.ticket");
  });

  it("resolves ticket and server path into absolute ws urls", () => {
    expect(connectWebSocketUrl("v2.ticket")).toBe(
      "wss://api.test/api/me/connect/ws?ticket=v2.ticket",
    );
    expect(connectWebSocketUrl("/api/me/connect/ws?ticket=v2.path")).toBe(
      "wss://api.test/api/me/connect/ws?ticket=v2.path",
    );
    expect(
      connectWebSocketUrl("https://api.test/api/me/connect/ws?ticket=x"),
    ).toBe("wss://api.test/api/me/connect/ws?ticket=x");
  });

  it("normalizes v2 player state into the legacy remote playback shape", () => {
    const state = connectPlayerStateToRemotePlaybackState({
      active_device_id: "device-2",
      active_device_label: "Safari",
      current_index: 1,
      duration_ms: 180000,
      play_source: { name: "Album", type: "album" },
      position_ms: 42000,
      queue: [
        {
          album: "Jane Doe",
          artist: "Converge",
          duration: 90,
          title: "Concubine",
          track_id: 1,
        },
        {
          album: "Jane Doe",
          album_cover: "/covers/jane.jpg",
          artist: "Converge",
          duration: 180,
          title: "Fault and Fracture",
          track_entity_uid: "track-2",
        },
      ],
      queue_revision: "rev-1",
      repeat: "all",
      shuffle: true,
      status: "playing",
      updated_at: "2026-05-31T10:00:00Z",
      version: 7,
    });

    expect(state).toMatchObject({
      album: "Jane Doe",
      album_cover: "/covers/jane.jpg",
      artist: "Converge",
      current_index: 1,
      device_id: "device-2",
      device_label: "Safari",
      duration_ms: 180000,
      position_ms: 42000,
      queue_revision: "rev-1",
      repeat_mode: "all",
      shuffle: true,
      status: "playing",
      title: "Fault and Fracture",
      track_entity_uid: "track-2",
      updated_at: "2026-05-31T10:00:00Z",
    });
    expect(state?.queue).toHaveLength(2);
  });
});
