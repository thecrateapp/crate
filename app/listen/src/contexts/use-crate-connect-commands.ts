import { useCallback, useEffect, useRef } from "react";

import type { AuthUser } from "@/contexts/auth-context";
import { useMediaAccessVersion } from "@/hooks/use-media-access-version";
import type { RemotePlaybackState } from "@/lib/remote-playback-state";
import {
  acknowledgeConnectCommand,
  connectCommandEventsUrl,
  emitConnectSessionChanged,
  fetchPendingConnectCommands,
  type CrateConnectCommand,
} from "@/lib/crate-connect";

interface ConnectCommandHandlers {
  isBuffering?: boolean;
  isPlaying?: boolean;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  onTransferIn: (state: RemotePlaybackState, startPlaying: boolean) => void;
  onTransferInPending?: (commandId: string) => void;
}

interface UseCrateConnectCommandsOptions extends ConnectCommandHandlers {
  authUser: AuthUser | null;
  enabled?: boolean;
}

const MAX_SEEN_COMMAND_IDS = 1000;
const STALE_COMMAND_MS = 30000;
const COMMAND_POLL_MS = 1500;

function numericPayload(
  payload: CrateConnectCommand["payload"] | undefined,
  ...keys: string[]
): number | null {
  for (const key of keys) {
    const value = payload?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function ack(
  commandId: string,
  status: "success" | "error" | "ignored",
  error?: string,
): Promise<void> {
  return acknowledgeConnectCommand(commandId, status, error).catch(() => {});
}

function isStaleCommand(command: CrateConnectCommand): boolean {
  const createdAt = command.created_at;
  if (typeof createdAt !== "string") return false;
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp > STALE_COMMAND_MS;
}

function handleConnectCommand(
  command: CrateConnectCommand,
  handlers: ConnectCommandHandlers,
): void {
  if (isStaleCommand(command)) {
    void ack(command.command_id, "ignored", "Stale Connect command").finally(
      emitConnectSessionChanged,
    );
    return;
  }

  const payload = command.payload ?? {};
  switch (command.type) {
    case "transfer_in": {
      const state = payload.state;
      if (!state) {
        void ack(command.command_id, "error", "Missing transfer state");
        return;
      }
      const startPlaying = payload.start_playing !== false;
      handlers.onTransferIn(state, startPlaying);
      if (startPlaying) {
        handlers.onTransferInPending?.(command.command_id);
        return;
      }
      void ack(command.command_id, "success").finally(
        emitConnectSessionChanged,
      );
      return;
    }
    case "transfer_out":
    case "pause":
      handlers.pause();
      if (command.type === "transfer_out") emitConnectSessionChanged();
      void ack(command.command_id, "success");
      return;
    case "play":
    case "resume":
      handlers.resume();
      void ack(command.command_id, "success");
      return;
    case "seek": {
      const positionMs = numericPayload(payload, "position_ms", "positionMs");
      if (positionMs === null) {
        void ack(command.command_id, "error", "Missing seek position");
        return;
      }
      handlers.seek(Math.max(0, positionMs / 1000));
      void ack(command.command_id, "success");
      return;
    }
    case "next":
      handlers.next();
      void ack(command.command_id, "success");
      return;
    case "previous":
      handlers.prev();
      void ack(command.command_id, "success");
      return;
    case "set_volume": {
      const volume = numericPayload(payload, "volume");
      if (volume === null) {
        void ack(command.command_id, "error", "Missing volume");
        return;
      }
      handlers.setVolume(Math.max(0, Math.min(volume, 1)));
      void ack(command.command_id, "success");
      return;
    }
    default:
      void ack(command.command_id, "ignored", "Unsupported command");
  }
}

export function useCrateConnectCommands({
  authUser,
  enabled = true,
  isBuffering = false,
  isPlaying = false,
  pause,
  resume,
  next,
  prev,
  seek,
  setVolume,
  onTransferIn,
}: UseCrateConnectCommandsOptions): void {
  const mediaAccessVersion = useMediaAccessVersion();
  const handlersRef = useRef<ConnectCommandHandlers>({
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
    onTransferIn,
  });
  const seenCommandIdsRef = useRef<Set<string>>(new Set());
  const seenCommandOrderRef = useRef<string[]>([]);
  const pendingTransferAckRef = useRef<string | null>(null);
  const pendingTransferTimeoutRef = useRef<number | null>(null);

  const markCommandSeen = useCallback((commandId: string) => {
    if (seenCommandIdsRef.current.has(commandId)) return false;
    seenCommandIdsRef.current.add(commandId);
    seenCommandOrderRef.current.push(commandId);
    while (seenCommandOrderRef.current.length > MAX_SEEN_COMMAND_IDS) {
      const evicted = seenCommandOrderRef.current.shift();
      if (evicted) seenCommandIdsRef.current.delete(evicted);
    }
    return true;
  }, []);

  const clearPendingTransferAck = useCallback(() => {
    if (pendingTransferTimeoutRef.current != null) {
      window.clearTimeout(pendingTransferTimeoutRef.current);
      pendingTransferTimeoutRef.current = null;
    }
    pendingTransferAckRef.current = null;
  }, []);

  const markTransferInPending = useCallback(
    (commandId: string) => {
      const previousCommandId = pendingTransferAckRef.current;
      if (previousCommandId && previousCommandId !== commandId) {
        void ack(
          previousCommandId,
          "error",
          "Transfer superseded by newer command",
        ).finally(emitConnectSessionChanged);
      }
      clearPendingTransferAck();
      pendingTransferAckRef.current = commandId;
      pendingTransferTimeoutRef.current = window.setTimeout(() => {
        if (pendingTransferAckRef.current !== commandId) return;
        clearPendingTransferAck();
        void ack(
          commandId,
          "error",
          "Transfer target did not become ready",
        ).finally(emitConnectSessionChanged);
      }, 15000);
    },
    [clearPendingTransferAck],
  );

  useEffect(() => {
    handlersRef.current = {
      isBuffering,
      isPlaying,
      pause,
      resume,
      next,
      prev,
      seek,
      setVolume,
      onTransferIn,
      onTransferInPending: markTransferInPending,
    };
  }, [
    isBuffering,
    isPlaying,
    next,
    onTransferIn,
    pause,
    prev,
    resume,
    seek,
    setVolume,
    markTransferInPending,
  ]);

  useEffect(() => {
    const pendingCommandId = pendingTransferAckRef.current;
    if (!pendingCommandId || !isPlaying || isBuffering) return;
    clearPendingTransferAck();
    void ack(pendingCommandId, "success").finally(emitConnectSessionChanged);
  }, [clearPendingTransferAck, isBuffering, isPlaying]);

  useEffect(() => {
    return () => {
      const pendingCommandId = pendingTransferAckRef.current;
      clearPendingTransferAck();
      if (pendingCommandId) {
        void ack(
          pendingCommandId,
          "error",
          "Transfer target disconnected before becoming ready",
        ).finally(emitConnectSessionChanged);
      }
    };
  }, [clearPendingTransferAck]);

  useEffect(() => {
    seenCommandIdsRef.current.clear();
    seenCommandOrderRef.current = [];
  }, [authUser?.id, enabled]);

  const processCommand = useCallback(
    (command: CrateConnectCommand) => {
      if (!command.command_id || !markCommandSeen(command.command_id)) {
        return;
      }
      handleConnectCommand(command, handlersRef.current);
    },
    [markCommandSeen],
  );

  useEffect(() => {
    if (!authUser || !enabled || typeof EventSource === "undefined") return;
    const source = new EventSource(connectCommandEventsUrl());
    const handleEvent = (event: MessageEvent) => {
      try {
        const command = JSON.parse(event.data) as CrateConnectCommand;
        processCommand(command);
      } catch {
        // Ignore malformed events; the stream will continue with the next command.
      }
    };

    source.addEventListener("connect.command", handleEvent as EventListener);
    return () => {
      source.removeEventListener(
        "connect.command",
        handleEvent as EventListener,
      );
      source.close();
    };
  }, [authUser, enabled, mediaAccessVersion, processCommand]);

  useEffect(() => {
    if (!authUser || !enabled) return;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const commands = await fetchPendingConnectCommands();
        if (!cancelled) {
          commands.forEach(processCommand);
        }
      } catch {
        // SSE remains the primary transport; polling is a best-effort fallback.
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const intervalId = window.setInterval(poll, COMMAND_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [authUser, enabled, processCommand]);
}
