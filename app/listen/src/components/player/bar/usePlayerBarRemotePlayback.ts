import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlayerActionsValue } from "@/contexts/player-context";
import { useCrateConnectEnabled } from "@/hooks/use-crate-connect-enabled";
import {
  CONNECT_SESSION_EVENT,
  CRATE_CONNECT_V2_TRANSPORT_ENABLED,
  fetchActiveConnectSnapshot,
  fetchConnectDevices,
  sendConnectCommand,
} from "@/lib/crate-connect";
import { formatCrateDeviceName, getListenDeviceId } from "@/lib/listen-device";
import type { ActiveConnectSession } from "@/lib/crate-connect";
import type { RemotePlaybackState } from "@/lib/remote-playback-state";
import { triggerHaptic } from "@/lib/haptics";
import { toast } from "sonner";

type RemoteTransportCommand =
  | "pause"
  | "resume"
  | "seek"
  | "next"
  | "previous"
  | "set_volume";

type UsePlayerBarRemotePlaybackOptions = {
  isPlaying: boolean;
  displayedTime: number;
  displayedDuration: number;
  volume: number;
  jamQueueLocked: boolean;
  actions: Pick<
    PlayerActionsValue,
    "pause" | "resume" | "next" | "prev" | "seek" | "setVolume" | "connect"
  >;
};

export function usePlayerBarRemotePlayback({
  isPlaying,
  displayedTime,
  displayedDuration,
  volume,
  jamQueueLocked,
  actions,
}: UsePlayerBarRemotePlaybackOptions) {
  const { pause, resume, next, prev, seek, setVolume, connect } = actions;
  const connectEnabled = useCrateConnectEnabled();
  const legacyConnectEnabled =
    connectEnabled && !CRATE_CONNECT_V2_TRANSPORT_ENABLED;
  const currentConnectDeviceId = useMemo(() => getListenDeviceId(), []);
  const [activeConnectSession, setActiveConnectSession] =
    useState<ActiveConnectSession | null>(null);
  const [activeConnectState, setActiveConnectState] =
    useState<RemotePlaybackState | null>(null);
  const [activeConnectStateFetchedAt, setActiveConnectStateFetchedAt] =
    useState<number | null>(null);
  const [activeConnectDeviceLabel, setActiveConnectDeviceLabel] = useState<
    string | null
  >(null);
  const [remoteClockTick, setRemoteClockTick] = useState(0);
  const optimisticRemoteTimeRef = useRef<number | null>(null);
  const optimisticRemoteVolumeRef = useRef<number | null>(null);
  const [optimisticRevision, setOptimisticRevision] = useState(0);
  const setOptimisticRemoteTime = useCallback((value: number | null) => {
    optimisticRemoteTimeRef.current = value;
    setOptimisticRevision((revision) => revision + 1);
  }, []);
  const setOptimisticRemoteVolume = useCallback((value: number | null) => {
    optimisticRemoteVolumeRef.current = value;
    setOptimisticRevision((revision) => revision + 1);
  }, []);

  const activeConnectDeviceId = activeConnectSession?.active_device_id ?? null;
  const legacyRemoteConnectActive = Boolean(
    legacyConnectEnabled &&
      activeConnectDeviceId &&
      activeConnectDeviceId !== currentConnectDeviceId,
  );
  const v2RemoteConnectActive = Boolean(
    connect.transport === "ws" && connect.isRemoteActive && connect.remoteState,
  );
  const isRemoteConnectActive =
    legacyRemoteConnectActive || v2RemoteConnectActive;
  const remoteConnectState = v2RemoteConnectActive
    ? connect.remoteState
    : activeConnectState;
  const activeConnectInstance =
    connect.transport === "ws"
      ? connect.connectedInstances.find(
          (instance) => instance.instance_id === connect.activeInstanceId,
        )
      : null;
  const remoteConnectDeviceLabel =
    isRemoteConnectActive && v2RemoteConnectActive
      ? formatCrateDeviceName({
          app_platform:
            activeConnectInstance?.app_platform ??
            connect.remoteState?.app_platform,
          device_label:
            activeConnectInstance?.device_label ??
            connect.remoteState?.device_label,
          device_type:
            activeConnectInstance?.device_type ??
            connect.remoteState?.device_type,
        })
      : isRemoteConnectActive
        ? activeConnectDeviceLabel
        : null;
  const effectiveIsPlaying = isRemoteConnectActive
    ? remoteConnectState?.status === "playing"
    : isPlaying;
  const remoteDuration =
    typeof remoteConnectState?.duration_ms === "number"
      ? remoteConnectState.duration_ms / 1000
      : 0;
  const remoteDisplayedTime = useMemo(() => {
    if (!isRemoteConnectActive || !remoteConnectState) return 0;
    const optimisticRemoteTime = optimisticRemoteTimeRef.current;
    if (optimisticRemoteTime !== null) return optimisticRemoteTime;
    const baseMs = Math.max(0, remoteConnectState.position_ms || 0);
    if (remoteConnectState.status !== "playing") return baseMs / 1000;
    if (v2RemoteConnectActive && remoteConnectState.position_updated_at) {
      const serverAnchor = Date.parse(remoteConnectState.position_updated_at);
      if (Number.isFinite(serverAnchor)) {
        const projected =
          baseMs +
          Math.max(0, Date.now() + connect.serverClockOffsetMs - serverAnchor);
        const durationMs = remoteConnectState.duration_ms || 0;
        return (
          (durationMs > 0 ? Math.min(projected, durationMs) : projected) / 1000
        );
      }
    }
    if (activeConnectStateFetchedAt === null) return baseMs / 1000;
    const elapsedMs = Math.max(0, Date.now() - activeConnectStateFetchedAt);
    const projected = baseMs + elapsedMs;
    const durationMs = remoteConnectState.duration_ms || 0;
    return (
      (durationMs > 0 ? Math.min(projected, durationMs) : projected) / 1000
    );
  }, [
    activeConnectStateFetchedAt,
    connect.serverClockOffsetMs,
    isRemoteConnectActive,
    optimisticRevision,
    remoteConnectState,
    remoteClockTick,
    v2RemoteConnectActive,
  ]);
  const effectiveDisplayedTime = isRemoteConnectActive
    ? remoteDisplayedTime
    : displayedTime;
  const effectiveDisplayedDuration =
    isRemoteConnectActive && remoteDuration > 0
      ? remoteDuration
      : displayedDuration;
  const effectiveVolume =
    isRemoteConnectActive && optimisticRemoteVolumeRef.current !== null
      ? optimisticRemoteVolumeRef.current
      : volume;

  const refreshConnectSession = useCallback(() => {
    let cancelled = false;
    if (!legacyConnectEnabled) {
      setActiveConnectSession(null);
      setActiveConnectState(null);
      setActiveConnectStateFetchedAt(null);
      setActiveConnectDeviceLabel(null);
      return () => {
        cancelled = true;
      };
    }
    void Promise.all([
      fetchActiveConnectSnapshot().catch(() => ({
        session: null,
        state: null,
      })),
      fetchConnectDevices().catch(() => ({ devices: [] })),
    ]).then(([snapshot, devices]) => {
      if (cancelled) return;
      const session = snapshot.session;
      setActiveConnectSession(session);
      setActiveConnectState(snapshot.state ?? null);
      setActiveConnectStateFetchedAt(snapshot.state ? Date.now() : null);
      const activeDeviceId = session?.active_device_id;
      const activeDevice = devices.devices.find(
        (device) => device.device_id === activeDeviceId,
      );
      setActiveConnectDeviceLabel(
        activeDevice
          ? formatCrateDeviceName(activeDevice)
          : activeDeviceId
            ? "Crate device"
            : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [legacyConnectEnabled]);
  const refreshConnectSessionCleanupRef = useRef<(() => void) | null>(null);
  const runRefreshConnectSession = useCallback(() => {
    refreshConnectSessionCleanupRef.current?.();
    refreshConnectSessionCleanupRef.current = refreshConnectSession();
  }, [refreshConnectSession]);

  useEffect(() => {
    runRefreshConnectSession();
    return () => {
      refreshConnectSessionCleanupRef.current?.();
      refreshConnectSessionCleanupRef.current = null;
    };
  }, [runRefreshConnectSession]);

  useEffect(() => {
    window.addEventListener(CONNECT_SESSION_EVENT, runRefreshConnectSession);
    window.addEventListener("focus", runRefreshConnectSession);
    return () => {
      window.removeEventListener(
        CONNECT_SESSION_EVENT,
        runRefreshConnectSession,
      );
      window.removeEventListener("focus", runRefreshConnectSession);
    };
  }, [runRefreshConnectSession]);

  useEffect(() => {
    if (!isRemoteConnectActive) {
      optimisticRemoteTimeRef.current = null;
      optimisticRemoteVolumeRef.current = null;
    }
  }, [isRemoteConnectActive]);

  useEffect(() => {
    if (!isRemoteConnectActive || remoteConnectState?.status !== "playing")
      return;
    const intervalId = window.setInterval(() => {
      setRemoteClockTick((value) => value + 1);
    }, 250);
    return () => window.clearInterval(intervalId);
  }, [isRemoteConnectActive, remoteConnectState?.status]);

  useEffect(() => {
    if (!isRemoteConnectActive) return;
    const intervalId = window.setInterval(runRefreshConnectSession, 2500);
    return () => window.clearInterval(intervalId);
  }, [isRemoteConnectActive, runRefreshConnectSession]);

  useEffect(() => {
    optimisticRemoteTimeRef.current = null;
    optimisticRemoteVolumeRef.current = null;
  }, [
    activeConnectSession?.playback_session_id,
    activeConnectSession?.state_revision,
  ]);

  const sendRemoteTransportCommand = useCallback(
    async (type: RemoteTransportCommand, payload?: Record<string, unknown>) => {
      if (v2RemoteConnectActive) {
        const wsType =
          type === "next"
            ? "next_track"
            : type === "previous"
              ? "previous_track"
              : type === "set_volume"
                ? "volume"
                : type;
        const ok = connect.sendRemoteCommand(wsType, payload);
        if (!ok) {
          toast.error(
            remoteConnectDeviceLabel
              ? `Could not control ${remoteConnectDeviceLabel}`
              : "Could not control remote device",
          );
        }
        return ok;
      }
      if (!isRemoteConnectActive || !activeConnectDeviceId) return false;
      try {
        await sendConnectCommand({
          type,
          targetDeviceId: activeConnectDeviceId,
          playbackSessionId: activeConnectSession?.playback_session_id,
          payload,
        });
        if (type === "pause" || type === "resume") {
          setActiveConnectSession((previous) =>
            previous
              ? {
                  ...previous,
                  status: type === "pause" ? "paused" : "playing",
                }
              : previous,
          );
        }
        window.setTimeout(runRefreshConnectSession, 600);
      } catch {
        toast.error(
          remoteConnectDeviceLabel
            ? `Could not control ${remoteConnectDeviceLabel}`
            : "Could not control remote device",
        );
        return false;
      }
      return true;
    },
    [
      activeConnectDeviceId,
      activeConnectSession?.playback_session_id,
      connect,
      isRemoteConnectActive,
      remoteConnectDeviceLabel,
      runRefreshConnectSession,
      v2RemoteConnectActive,
    ],
  );

  const handlePlayPause = useCallback(() => {
    triggerHaptic("light");
    if (jamQueueLocked) return;
    if (isRemoteConnectActive) {
      void sendRemoteTransportCommand(effectiveIsPlaying ? "pause" : "resume");
      return;
    }
    if (isPlaying) pause();
    else resume();
  }, [
    effectiveIsPlaying,
    isPlaying,
    jamQueueLocked,
    isRemoteConnectActive,
    pause,
    resume,
    sendRemoteTransportCommand,
  ]);

  const handlePreviousTrack = useCallback(() => {
    triggerHaptic("selection");
    if (jamQueueLocked) return;
    if (isRemoteConnectActive) {
      void sendRemoteTransportCommand("previous");
      return;
    }
    prev();
  }, [isRemoteConnectActive, jamQueueLocked, prev, sendRemoteTransportCommand]);

  const handleNextTrack = useCallback(() => {
    triggerHaptic("selection");
    if (jamQueueLocked) return;
    if (isRemoteConnectActive) {
      void sendRemoteTransportCommand("next");
      return;
    }
    next();
  }, [isRemoteConnectActive, jamQueueLocked, next, sendRemoteTransportCommand]);

  const handleSeek = useCallback(
    (time: number) => {
      if (jamQueueLocked) return;
      if (isRemoteConnectActive) {
        const nextTime =
          effectiveDisplayedDuration > 0
            ? Math.max(0, Math.min(time, effectiveDisplayedDuration))
            : Math.max(0, time);
        setOptimisticRemoteTime(nextTime);
        void sendRemoteTransportCommand("seek", {
          position_ms: Math.round(nextTime * 1000),
        }).then((ok) => {
          if (!ok) setOptimisticRemoteTime(null);
        });
        return;
      }
      seek(time);
    },
    [
      effectiveDisplayedDuration,
      jamQueueLocked,
      isRemoteConnectActive,
      seek,
      sendRemoteTransportCommand,
    ],
  );

  const handleVolumeChange = useCallback(
    (nextVolume: number) => {
      if (isRemoteConnectActive) {
        const normalizedVolume = Math.max(0, Math.min(1, nextVolume));
        setOptimisticRemoteVolume(normalizedVolume);
        void sendRemoteTransportCommand("set_volume", {
          volume: normalizedVolume,
        }).then((ok) => {
          if (!ok) setOptimisticRemoteVolume(null);
        });
        return;
      }
      setVolume(nextVolume);
    },
    [isRemoteConnectActive, sendRemoteTransportCommand, setVolume],
  );

  return {
    legacyConnectEnabled,
    activeConnectDeviceId,
    activeConnectSession,
    remoteConnectState,
    remoteConnectDeviceLabel,
    isRemoteConnectActive,
    effectiveIsPlaying,
    effectiveDisplayedTime,
    effectiveDisplayedDuration,
    effectiveVolume,
    handlePlayPause,
    handlePreviousTrack,
    handleNextTrack,
    handleSeek,
    handleVolumeChange,
  };
}
