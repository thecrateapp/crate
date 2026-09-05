import { useCallback, useEffect, useRef, useState } from "react";

import {
  CONNECT_ENABLED_EVENT,
  CRATE_CONNECT_FEATURE_ENABLED,
  applyCrateConnectPreference,
  connectWebSocketUrl,
  fetchConnectWsTicket,
  generatePlaybackInstanceId,
  type ConnectMessage,
  type ConnectPlayerState,
} from "@/lib/crate-connect";
import {
  getListenAppPlatform,
  getListenDeviceCapabilities,
  getListenDeviceId,
  getListenDeviceLabel,
  getListenDeviceType,
} from "@/lib/listen-device";
import type { PlaybackStatePayload } from "@/lib/remote-playback-state";

const HEARTBEAT_INTERVAL_MS = 30_000;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

export type CrateConnectWsStatus =
  | "disabled"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface ConnectedPlaybackInstance {
  instance_id: string;
  device_id?: string | null;
  device_label?: string | null;
  device_type?: string | null;
  app_platform?: string | null;
  connected_at?: string | null;
  capabilities?: Record<string, unknown> | null;
}

export interface ConnectedPlaybackInstancesSnapshot {
  instances: ConnectedPlaybackInstance[];
  active_instance_id?: string | null;
}

interface TransferIncomingPayload {
  transfer_id?: string;
  source_instance_id?: string;
  state?: ConnectPlayerState | null;
}

interface TransferCommittedPayload {
  active_instance_id?: string | null;
  active_device_label?: string | null;
}

interface TransferFailedPayload {
  transfer_id?: string | null;
  reason?: string | null;
}

interface BecameInactivePayload {
  active_instance_id?: string | null;
  active_device_label?: string | null;
}

type RemoteCommandType =
  | "seek"
  | "next_track"
  | "previous_track"
  | "pause"
  | "resume"
  | "volume";

interface UseCrateConnectWsCallbacks {
  onBecameInactive?: (payload: BecameInactivePayload) => void;
  onPlayerState?: (state: ConnectPlayerState | null) => void;
  onRemoteCommand?: (type: RemoteCommandType, payload: ConnectMessage) => void;
  onTransferCommitted?: (payload: TransferCommittedPayload) => void;
  onTransferFailed?: (payload: TransferFailedPayload) => void;
  onTransferIncoming?: (
    payload: TransferIncomingPayload,
  ) => boolean | Promise<boolean>;
}

interface UseCrateConnectWsOptions {
  authUserId?: number | null;
  enabled: boolean;
  callbacks?: UseCrateConnectWsCallbacks;
}

interface UseCrateConnectWsResult {
  activeInstanceId: string | null;
  claimActive: (positionMs?: number) => boolean;
  connected: boolean;
  connectedInstances: ConnectedPlaybackInstance[];
  lastError: string | null;
  playbackInstanceId: string;
  playerState: ConnectPlayerState | null;
  requestTransfer: (targetInstanceId: string) => boolean;
  serverClockOffsetMs: number;
  sendMessage: (message: ConnectMessage) => boolean;
  sendPosition: (positionMs: number) => boolean;
  sendSnapshot: (snapshot: PlaybackStatePayload) => boolean;
  sendStatus: (
    status: "playing" | "paused" | "stopped" | "buffering",
  ) => boolean;
  sendVolume: (volume: number) => boolean;
  status: CrateConnectWsStatus;
}

function parseMessage(data: unknown): ConnectMessage | null {
  try {
    if (typeof data === "string") return JSON.parse(data) as ConnectMessage;
    if (data instanceof Blob) return null;
    return data as ConnectMessage;
  } catch {
    return null;
  }
}

function serverTimeOffsetMs(message: ConnectMessage): number {
  const serverTime = message.payload?.server_time;
  if (typeof serverTime !== "string") return 0;
  const parsed = Date.parse(serverTime);
  return Number.isFinite(parsed) ? parsed - Date.now() : 0;
}

function normalizeInstances(
  payload: Record<string, unknown> | null | undefined,
): ConnectedPlaybackInstancesSnapshot {
  const rawInstances = Array.isArray(payload?.instances)
    ? payload?.instances
    : [];
  return {
    active_instance_id:
      typeof payload?.active_instance_id === "string"
        ? payload.active_instance_id
        : null,
    instances: rawInstances
      .filter(
        (entry): entry is ConnectedPlaybackInstance =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as ConnectedPlaybackInstance).instance_id === "string",
      )
      .map((entry) => ({ ...entry })),
  };
}

function isRemoteCommandType(type: string): type is RemoteCommandType {
  return (
    type === "seek" ||
    type === "next_track" ||
    type === "previous_track" ||
    type === "pause" ||
    type === "resume" ||
    type === "volume"
  );
}

function nextReconnectDelay(attempt: number): number {
  return Math.min(
    RECONNECT_MAX_DELAY_MS,
    RECONNECT_BASE_DELAY_MS * 2 ** Math.max(0, attempt),
  );
}

export function useCrateConnectWs({
  authUserId,
  enabled,
  callbacks,
}: UseCrateConnectWsOptions): UseCrateConnectWsResult {
  const callbacksRef = useRef<UseCrateConnectWsCallbacks | undefined>(
    callbacks,
  );
  const [playbackInstanceId] = useState(generatePlaybackInstanceId);
  const playbackInstanceIdRef = useRef(playbackInstanceId);
  const reconnectAttemptRef = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const playerStateRef = useRef<ConnectPlayerState | null>(null);
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const [connectedInstances, setConnectedInstances] = useState<
    ConnectedPlaybackInstance[]
  >([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [playerState, setPlayerState] = useState<ConnectPlayerState | null>(
    null,
  );
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const [status, setStatus] = useState<CrateConnectWsStatus>(() =>
    CRATE_CONNECT_FEATURE_ENABLED && enabled && authUserId
      ? "disconnected"
      : "disabled",
  );

  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    playerStateRef.current = playerState;
  }, [playerState]);

  const sendMessage = useCallback((message: ConnectMessage) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  const sendVersionedMessage = useCallback(
    (type: string, payload: Record<string, unknown> = {}) => {
      const currentState = playerStateRef.current;
      return sendMessage({
        type,
        payload,
        version:
          typeof currentState?.version === "number"
            ? currentState.version
            : null,
      });
    },
    [sendMessage],
  );

  const claimActive = useCallback(
    (positionMs = playerStateRef.current?.position_ms ?? 0) =>
      sendVersionedMessage("claim_active", {
        position_ms: Math.max(0, Math.round(positionMs)),
      }),
    [sendVersionedMessage],
  );

  const requestTransfer = useCallback(
    (targetInstanceId: string) =>
      sendVersionedMessage("transfer_request", {
        target_instance_id: targetInstanceId,
      }),
    [sendVersionedMessage],
  );

  const sendPosition = useCallback(
    (positionMs: number) =>
      sendVersionedMessage("update_position", {
        position_ms: Math.max(0, Math.round(positionMs)),
      }),
    [sendVersionedMessage],
  );

  const sendStatus = useCallback(
    (nextStatus: "playing" | "paused" | "stopped" | "buffering") =>
      sendVersionedMessage("update_status", { status: nextStatus }),
    [sendVersionedMessage],
  );

  const sendSnapshot = useCallback(
    (snapshot: PlaybackStatePayload) =>
      sendVersionedMessage(
        "update_snapshot",
        snapshot as unknown as Record<string, unknown>,
      ),
    [sendVersionedMessage],
  );

  const sendVolume = useCallback(
    (volume: number) =>
      sendVersionedMessage("update_volume", {
        volume: Math.max(0, Math.min(1, volume)),
      }),
    [sendVersionedMessage],
  );

  useEffect(() => {
    const shouldConnect =
      CRATE_CONNECT_FEATURE_ENABLED && enabled && Boolean(authUserId);
    let cancelled = false;
    let heartbeatTimer: number | undefined;
    let reconnectTimer: number | undefined;

    function clearTimers() {
      if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      heartbeatTimer = undefined;
      reconnectTimer = undefined;
    }

    function closeSocket() {
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        socket.close();
      }
    }

    function scheduleReconnect() {
      if (cancelled || !shouldConnect) return;
      const delay = nextReconnectDelay(reconnectAttemptRef.current);
      reconnectAttemptRef.current += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    }

    async function connect() {
      if (cancelled || !shouldConnect) return;
      setStatus("connecting");
      setLastError(null);
      try {
        const ticket = await fetchConnectWsTicket();
        if (cancelled || !shouldConnect) return;
        const socket = new WebSocket(connectWebSocketUrl(ticket.ws_url));
        socketRef.current = socket;

        socket.onopen = () => {
          reconnectAttemptRef.current = 0;
          heartbeatTimer = window.setInterval(() => {
            sendMessage({ type: "heartbeat", payload: {} });
          }, HEARTBEAT_INTERVAL_MS);
        };

        socket.onmessage = async (event) => {
          if (cancelled || socketRef.current !== socket) return;
          const message = parseMessage(event.data);
          if (!message?.type) return;

          if (message.type === "hello") {
            setServerClockOffsetMs(serverTimeOffsetMs(message));
            sendMessage({
              type: "hello",
              payload: {
                app_platform: getListenAppPlatform(),
                capabilities: getListenDeviceCapabilities(),
                device_id: getListenDeviceId(),
                device_label: getListenDeviceLabel(),
                device_type: getListenDeviceType(),
                playback_instance_id: playbackInstanceIdRef.current,
              },
            });
            setStatus("connected");
            return;
          }

          if (
            message.type === "player_state" ||
            message.type === "player_state_update"
          ) {
            const nextState = (message.payload ??
              null) as ConnectPlayerState | null;
            playerStateRef.current = nextState;
            setPlayerState(nextState);
            setActiveInstanceId(nextState?.active_instance_id ?? null);
            callbacksRef.current?.onPlayerState?.(nextState);
            return;
          }

          if (message.type === "connected_instances") {
            const snapshot = normalizeInstances(message.payload);
            setConnectedInstances(snapshot.instances);
            if (
              Object.prototype.hasOwnProperty.call(
                message.payload ?? {},
                "active_instance_id",
              )
            ) {
              setActiveInstanceId(snapshot.active_instance_id ?? null);
            }
            return;
          }

          if (message.type === "connect_preferences") {
            applyCrateConnectPreference(Boolean(message.payload?.enabled));
            return;
          }

          if (message.type === "became_inactive") {
            const payload = (message.payload ?? {}) as BecameInactivePayload;
            if (typeof payload.active_instance_id === "string") {
              setActiveInstanceId(payload.active_instance_id);
            }
            callbacksRef.current?.onBecameInactive?.(payload);
            return;
          }

          if (message.type === "transfer_incoming") {
            const payload = (message.payload ?? {}) as TransferIncomingPayload;
            const accepted =
              (await callbacksRef.current?.onTransferIncoming?.(payload)) ??
              true;
            const incomingVersion =
              typeof message.version === "number"
                ? message.version
                : typeof payload.state?.version === "number"
                  ? payload.state.version
                  : typeof playerStateRef.current?.version === "number"
                    ? playerStateRef.current.version
                    : null;
            sendMessage({
              type: accepted ? "transfer_ready" : "transfer_cancel",
              payload: {
                transfer_id: payload.transfer_id,
                ...(accepted ? {} : { reason: "target-rejected" }),
              },
              version: incomingVersion,
            });
            return;
          }

          if (message.type === "transfer_committed") {
            const payload = (message.payload ?? {}) as TransferCommittedPayload;
            if (typeof payload.active_instance_id === "string") {
              setActiveInstanceId(payload.active_instance_id);
            }
            callbacksRef.current?.onTransferCommitted?.(payload);
            return;
          }

          if (message.type === "transfer_failed") {
            callbacksRef.current?.onTransferFailed?.(
              (message.payload ?? {}) as TransferFailedPayload,
            );
            return;
          }

          if (isRemoteCommandType(message.type)) {
            callbacksRef.current?.onRemoteCommand?.(message.type, message);
            return;
          }

          if (message.type === "error") {
            const errorMessage =
              typeof message.payload?.message === "string"
                ? message.payload.message
                : "Crate Connect error";
            setLastError(errorMessage);
            setStatus("error");
          }
        };

        socket.onerror = () => {
          if (cancelled || socketRef.current !== socket) return;
          setLastError("Crate Connect socket error");
          setStatus("error");
        };

        socket.onclose = () => {
          if (socketRef.current === socket) socketRef.current = null;
          clearTimers();
          if (cancelled || !shouldConnect) return;
          setStatus("disconnected");
          scheduleReconnect();
        };
      } catch (error) {
        if (cancelled || !shouldConnect) return;
        setLastError(error instanceof Error ? error.message : String(error));
        setStatus("error");
        scheduleReconnect();
      }
    }

    if (!shouldConnect) {
      setStatus("disabled");
      setActiveInstanceId(null);
      setConnectedInstances([]);
      setLastError(null);
      setPlayerState(null);
      closeSocket();
      clearTimers();
      return;
    }

    void connect();
    window.addEventListener(CONNECT_ENABLED_EVENT, closeSocket);
    return () => {
      cancelled = true;
      window.removeEventListener(CONNECT_ENABLED_EVENT, closeSocket);
      clearTimers();
      closeSocket();
    };
  }, [authUserId, enabled, sendMessage]);

  return {
    activeInstanceId,
    claimActive,
    connected: status === "connected",
    connectedInstances,
    lastError,
    playbackInstanceId: playbackInstanceIdRef.current,
    playerState,
    requestTransfer,
    serverClockOffsetMs,
    sendMessage,
    sendPosition,
    sendSnapshot,
    sendStatus,
    sendVolume,
    status,
  };
}
