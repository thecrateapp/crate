import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { AuthUser } from "@/contexts/auth-context";
import type { PlayerConnectValue } from "@/contexts/player-context";
import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import { clampIndex } from "@/contexts/player-queue-helpers";
import { useCrateConnectCommands } from "@/contexts/use-crate-connect-commands";
import { useCrateConnectWs } from "@/hooks/use-crate-connect-ws";
import { connectPlayerStateToRemotePlaybackState } from "@/lib/crate-connect";
import {
  remotePlaybackQueue,
  remoteTrackToPlayerTrack,
  type PlaybackStatePayload,
  type RemotePlaybackState,
} from "@/lib/remote-playback-state";

interface Ref<T> {
  current: T;
}

type ConnectPublishOptions = { claimActive?: boolean };
type PublishConnectState = (options?: ConnectPublishOptions) => Promise<void>;
type BuildConnectSnapshotPayload = (
  snapshotKind: "light" | "structural",
  options?: ConnectPublishOptions,
) => PlaybackStatePayload;

interface UsePlayerConnectTransportOptions {
  authUser: AuthUser | null;
  buildConnectSnapshotPayload: BuildConnectSnapshotPayload;
  commitCurrentTime: (time: number) => void;
  commitDuration: (duration: number) => void;
  connectEnabled: boolean;
  connectV1Enabled: boolean;
  connectV2Enabled: boolean;
  connectV2PublishRef: Ref<PublishConnectState | null>;
  currentTimeRef: Ref<number>;
  currentIndex: number;
  isBuffering: boolean;
  isPlaying: boolean;
  isPlayingRef: Ref<boolean>;
  pendingRestoreTimeRef: Ref<number>;
  playSource: PlaySource | null;
  playSourceRef: Ref<PlaySource | null>;
  pushToEngine: (
    queue: Track[],
    index: number,
    options?: { autoplay?: boolean; positionMs?: number },
  ) => void;
  queue: Track[];
  queueRef: Ref<Track[]>;
  repeat: RepeatMode;
  repeatRef: Ref<RepeatMode>;
  requireUserGestureToResume: () => void;
  publishConnectState: PublishConnectState;
  setPlaySource: Dispatch<SetStateAction<PlaySource | null>>;
  setRepeatState: Dispatch<SetStateAction<RepeatMode>>;
  setShuffleState: Dispatch<SetStateAction<boolean>>;
  setVolume: (volume: number) => void;
  shuffle: boolean;
  shuffleRef: Ref<boolean>;
  suppressNextConnectClaimRef: Ref<boolean>;
  unshuffledQueueRef: Ref<Track[] | null>;
  volume: number;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
}

interface ConnectedInstanceLike {
  instance_id: string;
}

export function hasRemoteConnectOwner(
  enabled: boolean,
  activeInstanceId: string | null,
  playbackInstanceId: string | null,
  connectedInstances: readonly ConnectedInstanceLike[],
): boolean {
  return (
    enabled &&
    Boolean(activeInstanceId) &&
    connectedInstances.some(
      (instance) => instance.instance_id === activeInstanceId,
    ) &&
    Boolean(playbackInstanceId) &&
    activeInstanceId !== playbackInstanceId
  );
}

const noConnectTransfer = () => false;
const noConnectRemoteCommand = () => false;

export interface PlayerConnectTransportRuntime {
  clearTransferPlaybackGuard: () => void;
  connectValue: PlayerConnectValue;
}

export function usePlayerConnectTransport({
  authUser,
  buildConnectSnapshotPayload,
  commitCurrentTime,
  commitDuration,
  connectEnabled,
  connectV1Enabled,
  connectV2Enabled,
  connectV2PublishRef,
  currentIndex,
  currentTimeRef,
  isBuffering,
  isPlaying,
  isPlayingRef,
  pendingRestoreTimeRef,
  playSource,
  playSourceRef,
  pushToEngine,
  queue,
  queueRef,
  repeat,
  repeatRef,
  requireUserGestureToResume,
  publishConnectState,
  setPlaySource,
  setRepeatState,
  setShuffleState,
  setVolume,
  shuffle,
  shuffleRef,
  suppressNextConnectClaimRef,
  unshuffledQueueRef,
  volume,
  pause,
  resume,
  next,
  prev,
  seek,
}: UsePlayerConnectTransportOptions): PlayerConnectTransportRuntime {
  const clearTransferPlaybackGuardRef = useRef<number | null>(null);
  const clearTransferPlaybackGuard = useCallback(() => {
    if (clearTransferPlaybackGuardRef.current === null) return;
    window.clearTimeout(clearTransferPlaybackGuardRef.current);
    clearTransferPlaybackGuardRef.current = null;
  }, []);
  const scheduleTransferPlaybackGuard = useCallback(() => {
    clearTransferPlaybackGuard();
    const startedAtSeconds = currentTimeRef.current;
    clearTransferPlaybackGuardRef.current = window.setTimeout(() => {
      clearTransferPlaybackGuardRef.current = null;
      const advancedEnough = currentTimeRef.current > startedAtSeconds + 0.25;
      if (isPlayingRef.current && advancedEnough) return;
      requireUserGestureToResume();
    }, 2500);
  }, [
    clearTransferPlaybackGuard,
    currentTimeRef,
    isPlayingRef,
    requireUserGestureToResume,
  ]);

  const applyConnectStateToLocalQueue = useCallback(
    (state: RemotePlaybackState, startPlaying: boolean) => {
      const tracks = remotePlaybackQueue(state);
      if (!tracks.length) return false;
      const nextIndex = clampIndex(state.current_index, tracks.length);
      const nextRepeat =
        state.repeat_mode === "one" || state.repeat_mode === "all"
          ? state.repeat_mode
          : "off";
      const nextShuffle = Boolean(state.shuffle);
      const nextSource =
        state.play_source ||
        (tracks.length > 1
          ? { type: "queue" as const, name: "Queue" }
          : {
              type: "track" as const,
              name: tracks[nextIndex]?.title || "Track",
            });

      if (startPlaying) {
        suppressNextConnectClaimRef.current = true;
      }
      repeatRef.current = nextRepeat;
      shuffleRef.current = nextShuffle;
      playSourceRef.current = nextSource;
      unshuffledQueueRef.current = state.unshuffled_queue
        ? state.unshuffled_queue.map(remoteTrackToPlayerTrack)
        : null;
      setRepeatState(nextRepeat);
      setShuffleState(nextShuffle);
      setPlaySource(nextSource);
      const positionSeconds = Math.max(0, (state.position_ms || 0) / 1000);
      pendingRestoreTimeRef.current = positionSeconds;
      pushToEngine(tracks, nextIndex, {
        autoplay: startPlaying,
        positionMs: Math.max(0, state.position_ms || 0),
      });
      commitCurrentTime(positionSeconds);
      commitDuration(Math.max(0, (state.duration_ms || 0) / 1000));
      return true;
    },
    [
      commitCurrentTime,
      commitDuration,
      pendingRestoreTimeRef,
      playSourceRef,
      pushToEngine,
      repeatRef,
      setPlaySource,
      setRepeatState,
      setShuffleState,
      shuffleRef,
      suppressNextConnectClaimRef,
      unshuffledQueueRef,
    ],
  );

  const handleConnectTransferIn = useCallback(
    (state: RemotePlaybackState, startPlaying: boolean) => {
      applyConnectStateToLocalQueue(state, startPlaying);
    },
    [applyConnectStateToLocalQueue],
  );

  const handleConnectV2TransferIncoming = useCallback(
    (payload: { state?: unknown }) => {
      const remoteState = connectPlayerStateToRemotePlaybackState(
        payload.state as Parameters<
          typeof connectPlayerStateToRemotePlaybackState
        >[0],
      );
      if (!remoteState) return false;
      return applyConnectStateToLocalQueue(remoteState, false);
    },
    [applyConnectStateToLocalQueue],
  );

  const handleConnectV2RemoteCommand = useCallback(
    (
      type:
        | "seek"
        | "next_track"
        | "previous_track"
        | "pause"
        | "resume"
        | "volume",
      payload: { payload?: Record<string, unknown> | null },
    ) => {
      if (type === "pause") {
        pause();
        return;
      }
      if (type === "resume") {
        resume();
        return;
      }
      if (type === "next_track") {
        next();
        return;
      }
      if (type === "previous_track") {
        prev();
        return;
      }
      if (type === "volume") {
        const rawVolume = payload.payload?.volume;
        if (typeof rawVolume === "number" && Number.isFinite(rawVolume)) {
          setVolume(Math.max(0, Math.min(1, rawVolume)));
        }
        return;
      }
      const rawPosition =
        payload.payload?.position_ms ?? payload.payload?.positionMs;
      if (typeof rawPosition === "number" && Number.isFinite(rawPosition)) {
        seek(Math.max(0, rawPosition / 1000));
        void publishConnectState();
      }
    },
    [next, pause, prev, publishConnectState, resume, seek, setVolume],
  );

  const {
    activeInstanceId: connectV2ActiveInstanceId,
    connectedInstances: connectV2ConnectedInstances,
    playbackInstanceId: connectV2PlaybackInstanceId,
    playerState: connectV2PlayerState,
    requestTransfer: requestConnectV2Transfer,
    serverClockOffsetMs: connectV2ServerClockOffsetMs,
    sendMessage: sendConnectV2Message,
    sendSnapshot: sendConnectV2Snapshot,
    sendVolume: sendConnectV2Volume,
  } = useCrateConnectWs({
    authUserId: authUser?.id,
    callbacks: {
      onBecameInactive: pause,
      onRemoteCommand: handleConnectV2RemoteCommand,
      onTransferCommitted: () => {
        resume();
        void publishConnectState({ claimActive: true });
        scheduleTransferPlaybackGuard();
      },
      onTransferIncoming: handleConnectV2TransferIncoming,
    },
    enabled: connectV2Enabled,
  });
  const connectV2IsActive =
    connectV2ActiveInstanceId === connectV2PlaybackInstanceId;
  const connectV2HasRemoteOwner = hasRemoteConnectOwner(
    connectV2Enabled,
    connectV2ActiveInstanceId,
    connectV2PlaybackInstanceId,
    connectV2ConnectedInstances,
  );
  const connectV2RemoteState = useMemo(
    () => connectPlayerStateToRemotePlaybackState(connectV2PlayerState),
    [connectV2PlayerState],
  );
  const sendConnectV2RemoteCommand = useCallback(
    (
      type:
        | "pause"
        | "resume"
        | "seek"
        | "next_track"
        | "previous_track"
        | "volume",
      payload?: Record<string, unknown>,
    ) =>
      sendConnectV2Message({
        payload: payload ?? {},
        type,
        version: null,
      }),
    [sendConnectV2Message],
  );
  const publishConnectV2State = useCallback(
    async (options?: ConnectPublishOptions) => {
      if (!authUser?.id || !connectV2Enabled || !queueRef.current.length)
        return;
      const payload = buildConnectSnapshotPayload(
        options?.claimActive ? "structural" : "light",
        options,
      );
      if (options?.claimActive) {
        sendConnectV2Message({
          payload: { position_ms: payload.position_ms },
          type: "claim_active",
          version: null,
        });
        sendConnectV2Message({
          payload: payload as unknown as Record<string, unknown>,
          type: "update_snapshot",
          version: null,
        });
        return;
      }
      if (!connectV2IsActive) return;
      sendConnectV2Snapshot(payload);
    },
    [
      authUser?.id,
      buildConnectSnapshotPayload,
      connectV2Enabled,
      connectV2IsActive,
      queueRef,
      sendConnectV2Message,
      sendConnectV2Snapshot,
    ],
  );
  useEffect(() => {
    connectV2PublishRef.current = connectV2Enabled
      ? publishConnectV2State
      : null;
  }, [connectV2Enabled, connectV2PublishRef, publishConnectV2State]);

  const connectV2StructuralRevisionRef = useRef<string | null>(null);
  const connectV2ClaimedPlaybackRef = useRef<string | null>(null);
  useEffect(() => {
    if (!authUser?.id || !connectV2Enabled || !isPlaying || !queue.length)
      return;
    if (
      connectV2ActiveInstanceId &&
      connectV2ActiveInstanceId !== connectV2PlaybackInstanceId
    ) {
      return;
    }
    const payload = buildConnectSnapshotPayload("structural", {
      claimActive: true,
    });
    const claimKey = [
      payload.queue_revision,
      payload.current_index,
      payload.track_id ?? payload.track_entity_uid ?? payload.track_path ?? "",
      payload.status,
    ].join(":");
    if (claimKey === connectV2ClaimedPlaybackRef.current) return;
    connectV2ClaimedPlaybackRef.current = claimKey;
    sendConnectV2Message({
      payload: { position_ms: payload.position_ms },
      type: "claim_active",
      version: null,
    });
    sendConnectV2Message({
      payload: payload as unknown as Record<string, unknown>,
      type: "update_snapshot",
      version: null,
    });
  }, [
    authUser?.id,
    buildConnectSnapshotPayload,
    connectV2ActiveInstanceId,
    connectV2Enabled,
    connectV2PlaybackInstanceId,
    currentIndex,
    isPlaying,
    queue,
    sendConnectV2Message,
  ]);

  useEffect(() => {
    if (!connectV2Enabled || !connectV2IsActive || !queue.length) return;
    const payload = buildConnectSnapshotPayload("structural");
    if (payload.queue_revision === connectV2StructuralRevisionRef.current)
      return;
    connectV2StructuralRevisionRef.current = payload.queue_revision;
    sendConnectV2Snapshot(payload);
  }, [
    buildConnectSnapshotPayload,
    connectV2Enabled,
    connectV2IsActive,
    currentIndex,
    playSource,
    queue,
    repeat,
    sendConnectV2Snapshot,
    shuffle,
  ]);

  useEffect(() => {
    if (!connectV2Enabled || !connectV2IsActive || !queueRef.current.length)
      return;
    sendConnectV2Snapshot(buildConnectSnapshotPayload("light"));
  }, [
    buildConnectSnapshotPayload,
    connectV2Enabled,
    connectV2IsActive,
    isPlaying,
    queueRef,
    sendConnectV2Snapshot,
  ]);

  useEffect(() => {
    if (!connectV2Enabled || !connectV2IsActive) return;
    sendConnectV2Volume(volume);
  }, [connectV2Enabled, connectV2IsActive, sendConnectV2Volume, volume]);

  useEffect(() => {
    if (!connectV2Enabled || !connectV2IsActive) return;
    const intervalId = window.setInterval(() => {
      if (!queueRef.current.length) return;
      sendConnectV2Snapshot(buildConnectSnapshotPayload("light"));
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [
    buildConnectSnapshotPayload,
    connectV2Enabled,
    connectV2IsActive,
    queueRef,
    sendConnectV2Snapshot,
  ]);

  useCrateConnectCommands({
    authUser,
    enabled: connectV1Enabled,
    isBuffering,
    isPlaying,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
    onTransferIn: handleConnectTransferIn,
  });

  const connectValue = useMemo<PlayerConnectValue>(
    () => ({
      activeInstanceId: connectV2Enabled ? connectV2ActiveInstanceId : null,
      connectedInstances: connectV2Enabled ? connectV2ConnectedInstances : [],
      enabled: connectEnabled,
      isRemoteActive: connectV2HasRemoteOwner,
      playbackInstanceId: connectV2Enabled ? connectV2PlaybackInstanceId : null,
      remoteState: connectV2Enabled ? connectV2RemoteState : null,
      requestTransfer: connectV2Enabled
        ? requestConnectV2Transfer
        : noConnectTransfer,
      sendRemoteCommand: connectV2Enabled
        ? sendConnectV2RemoteCommand
        : noConnectRemoteCommand,
      serverClockOffsetMs: connectV2Enabled ? connectV2ServerClockOffsetMs : 0,
      transport: connectEnabled ? (connectV2Enabled ? "ws" : "legacy") : null,
    }),
    [
      connectEnabled,
      connectV2ActiveInstanceId,
      connectV2ConnectedInstances,
      connectV2Enabled,
      connectV2HasRemoteOwner,
      connectV2PlaybackInstanceId,
      connectV2RemoteState,
      connectV2ServerClockOffsetMs,
      requestConnectV2Transfer,
      sendConnectV2RemoteCommand,
    ],
  );

  return { clearTransferPlaybackGuard, connectValue };
}
