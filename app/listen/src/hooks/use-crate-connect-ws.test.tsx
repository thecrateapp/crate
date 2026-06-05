import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyCrateConnectPreference: vi.fn(),
  connectWebSocketUrl: vi.fn(() => "wss://api.test/api/me/connect/ws"),
  featureEnabled: { current: true },
  fetchConnectWsTicket: vi.fn(),
  generatePlaybackInstanceId: vi.fn(() => "instance-1"),
}));

vi.mock("@/lib/crate-connect", () => ({
  CONNECT_ENABLED_EVENT: "crate:connect-enabled-changed",
  get CRATE_CONNECT_FEATURE_ENABLED() {
    return mocks.featureEnabled.current;
  },
  applyCrateConnectPreference: mocks.applyCrateConnectPreference,
  connectWebSocketUrl: mocks.connectWebSocketUrl,
  fetchConnectWsTicket: mocks.fetchConnectWsTicket,
  generatePlaybackInstanceId: mocks.generatePlaybackInstanceId,
}));

vi.mock("@/lib/listen-device", () => ({
  getListenAppPlatform: vi.fn(() => "listen-web"),
  getListenDeviceCapabilities: vi.fn(() => ({
    can_background_play: false,
    can_play: true,
    can_receive_commands: true,
    can_set_volume: true,
    supports_cast_sender: false,
    supports_native_audio: false,
  })),
  getListenDeviceId: vi.fn(() => "device-1"),
  getListenDeviceLabel: vi.fn(() => "Crate on Chrome"),
  getListenDeviceType: vi.fn(() => "web"),
}));

import { useCrateConnectWs } from "@/hooks/use-crate-connect-ws";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1000 } as CloseEvent);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({} as Event);
  }

  receive(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }
}

function sentMessages(socket: FakeWebSocket) {
  return socket.sent.map(
    (entry) => JSON.parse(entry) as Record<string, unknown> & { type: string },
  );
}

function installFakeWebSocket() {
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: FakeWebSocket,
  });
  Object.defineProperty(window, "WebSocket", {
    configurable: true,
    value: FakeWebSocket,
  });
}

async function connectHook() {
  const hook = renderHook(() =>
    useCrateConnectWs({ authUserId: 7, enabled: true }),
  );
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  const socket = FakeWebSocket.instances[0]!;
  act(() => {
    socket.open();
    socket.receive({
      type: "hello",
      payload: { server_time: new Date().toISOString() },
    });
  });
  await waitFor(() => expect(hook.result.current.connected).toBe(true));
  return { hook, socket };
}

describe("useCrateConnectWs", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    installFakeWebSocket();
    mocks.featureEnabled.current = true;
    mocks.connectWebSocketUrl.mockReturnValue(
      "wss://api.test/api/me/connect/ws",
    );
    mocks.fetchConnectWsTicket.mockResolvedValue({
      expires_at: "2026-05-31T10:00:00Z",
      ticket: "v2.ticket",
      ws_url: "/api/me/connect/ws?ticket=v2.ticket",
    });
    mocks.generatePlaybackInstanceId.mockReturnValue("instance-1");
    mocks.applyCrateConnectPreference.mockReset();
  });

  it("does not open a socket while the feature flag is off", async () => {
    mocks.featureEnabled.current = false;

    const { result } = renderHook(() =>
      useCrateConnectWs({ authUserId: 7, enabled: true }),
    );

    await waitFor(() => expect(result.current.status).toBe("disabled"));
    expect(mocks.fetchConnectWsTicket).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("performs the ticketed hello handshake", async () => {
    const { hook, socket } = await connectHook();
    const hello = sentMessages(socket).find(
      (message) => message.type === "hello",
    );

    expect(mocks.fetchConnectWsTicket).toHaveBeenCalledTimes(1);
    expect(mocks.connectWebSocketUrl).toHaveBeenCalledWith(
      "/api/me/connect/ws?ticket=v2.ticket",
    );
    expect(hook.result.current.playbackInstanceId).toBe("instance-1");
    expect(hello).toMatchObject({
      payload: {
        app_platform: "listen-web",
        device_id: "device-1",
        device_label: "Crate on Chrome",
        device_type: "web",
        playback_instance_id: "instance-1",
      },
      type: "hello",
    });
  });

  it("tracks player state and sends versioned commands", async () => {
    const { hook, socket } = await connectHook();

    act(() => {
      socket.receive({
        payload: {
          active_instance_id: "instance-2",
          position_ms: 42000,
          status: "playing",
          version: 4,
        },
        type: "player_state",
        version: 4,
      });
    });

    await waitFor(() =>
      expect(hook.result.current.playerState?.version).toBe(4),
    );

    act(() => {
      hook.result.current.claimActive(1234);
      hook.result.current.requestTransfer("instance-2");
      hook.result.current.sendSnapshot({
        album: "Album",
        app_platform: "listen-web",
        artist: "Artist",
        current_index: 0,
        device_id: "device-1",
        device_type: "web",
        playback_rate: 1,
        position_ms: 5000,
        queue_revision: "rev-1",
        repeat_mode: "off",
        shuffle: false,
        snapshot_kind: "light",
        status: "playing",
        title: "Track",
      });
    });

    expect(sentMessages(socket).slice(-3)).toEqual([
      {
        payload: { position_ms: 1234 },
        type: "claim_active",
        version: 4,
      },
      {
        payload: { target_instance_id: "instance-2" },
        type: "transfer_request",
        version: 4,
      },
      {
        payload: {
          album: "Album",
          app_platform: "listen-web",
          artist: "Artist",
          current_index: 0,
          device_id: "device-1",
          device_type: "web",
          playback_rate: 1,
          position_ms: 5000,
          queue_revision: "rev-1",
          repeat_mode: "off",
          shuffle: false,
          snapshot_kind: "light",
          status: "playing",
          title: "Track",
        },
        type: "update_snapshot",
        version: 4,
      },
    ]);
  });

  it("preserves the active owner when connected instances omit it", async () => {
    const { hook, socket } = await connectHook();

    act(() => {
      socket.receive({
        payload: {
          active_instance_id: "instance-2",
          position_ms: 42000,
          status: "playing",
          version: 4,
        },
        type: "player_state",
        version: 4,
      });
    });

    await waitFor(() =>
      expect(hook.result.current.activeInstanceId).toBe("instance-2"),
    );

    act(() => {
      socket.receive({
        payload: {
          instances: [
            { device_label: "Chrome", instance_id: "instance-2" },
            { device_label: "Safari", instance_id: "instance-1" },
          ],
        },
        type: "connected_instances",
      });
    });

    expect(hook.result.current.connectedInstances).toHaveLength(2);
    expect(hook.result.current.activeInstanceId).toBe("instance-2");
  });

  it("updates the active owner immediately from transfer events", async () => {
    const onBecameInactive = vi.fn();
    const onTransferCommitted = vi.fn();
    const hook = renderHook(() =>
      useCrateConnectWs({
        authUserId: 7,
        callbacks: { onBecameInactive, onTransferCommitted },
        enabled: true,
      }),
    );
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;

    act(() => {
      socket.open();
      socket.receive({ type: "hello", payload: {} });
      socket.receive({
        payload: { active_instance_id: "instance-2" },
        type: "transfer_committed",
      });
    });

    await waitFor(() =>
      expect(hook.result.current.activeInstanceId).toBe("instance-2"),
    );
    expect(onTransferCommitted).toHaveBeenCalledWith({
      active_instance_id: "instance-2",
    });

    act(() => {
      socket.receive({
        payload: { active_instance_id: "instance-3" },
        type: "became_inactive",
      });
    });

    await waitFor(() =>
      expect(hook.result.current.activeInstanceId).toBe("instance-3"),
    );
    expect(onBecameInactive).toHaveBeenCalledWith({
      active_instance_id: "instance-3",
    });
    hook.unmount();
  });

  it("applies preference updates broadcast by another device", async () => {
    const { socket } = await connectHook();

    act(() => {
      socket.receive({
        payload: { enabled: false },
        type: "connect_preferences",
      });
    });

    expect(mocks.applyCrateConnectPreference).toHaveBeenCalledWith(false);
  });

  it("acks transfer readiness with the incoming player state version", async () => {
    const onTransferIncoming = vi.fn(async () => true);
    const hook = renderHook(() =>
      useCrateConnectWs({
        authUserId: 7,
        callbacks: { onTransferIncoming },
        enabled: true,
      }),
    );
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;

    act(() => {
      socket.open();
      socket.receive({ type: "hello", payload: {} });
      socket.receive({
        payload: {
          state: { active_instance_id: "source", version: 8 },
          transfer_id: "transfer-1",
        },
        type: "transfer_incoming",
      });
    });

    await waitFor(() => expect(onTransferIncoming).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(sentMessages(socket)[sentMessages(socket).length - 1]).toEqual({
        payload: { transfer_id: "transfer-1" },
        type: "transfer_ready",
        version: 8,
      }),
    );
    hook.unmount();
  });

  it("routes volume commands to the remote command callback", async () => {
    const onRemoteCommand = vi.fn();
    const hook = renderHook(() =>
      useCrateConnectWs({
        authUserId: 7,
        callbacks: { onRemoteCommand },
        enabled: true,
      }),
    );
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0]!;

    act(() => {
      socket.open();
      socket.receive({ type: "hello", payload: {} });
      socket.receive({
        payload: { volume: 0.42 },
        type: "volume",
        version: 9,
      });
    });

    await waitFor(() =>
      expect(onRemoteCommand).toHaveBeenCalledWith(
        "volume",
        expect.objectContaining({
          payload: { volume: 0.42 },
          type: "volume",
        }),
      ),
    );
    hook.unmount();
  });
});
