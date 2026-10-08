import {
  CAST_PROTOCOL_VERSION,
  type CastPlayerState,
  type CastProtocolMessage,
  type CastQueueSnapshotMessage,
  type CastReceiverError,
  type CastReceiverStatusMessage,
} from "@crate/cast-protocol";

import type { CrateLoadData } from "./caf-types";
import {
  loadReceiverSession,
  publishPlayCheckpoint,
  publishReceiverState,
  type PlayCheckpoint,
  type ReceiverSession,
  type ReceiverStateUpdate,
} from "./receiver-client";
import type { ReceiverPhase, ReceiverStore } from "./receiver-store";
import type { ReceiverTelemetry } from "./sentry";

interface ReceiverSessionRuntimeOptions {
  store: ReceiverStore;
  loadSession?: typeof loadReceiverSession;
  publishState?: (
    bootstrapUrl: string,
    update: ReceiverStateUpdate,
  ) => Promise<void>;
  publishCheckpoint?: (
    bootstrapUrl: string,
    checkpoint: PlayCheckpoint,
  ) => Promise<void>;
  sendProtocolMessage(message: CastProtocolMessage): void;
  now?: () => Date;
  makeMessageId?: () => string;
  retryCurrentItem?: () => boolean;
  skipCurrentItem?: () => boolean;
  telemetry?: ReceiverTelemetry;
}

interface ActiveSession {
  bootstrapUrl: string;
  sessionId: string;
}

interface ActiveCheckpoint {
  itemId: string;
  startedAt: Date;
  lastObservedAt: Date;
  lastPosition: number;
  playedSeconds: number;
}

const STATE_INTERVAL_MS = 5_000;

function playerStateForPhase(phase: ReceiverPhase): CastPlayerState {
  if (phase === "playing") return "PLAYING";
  if (phase === "paused") return "PAUSED";
  if (phase === "recovering") return "RECOVERING";
  if (phase === "buffering" || phase === "loading") return "BUFFERING";
  return "IDLE";
}

export function createReceiverSessionRuntime({
  store,
  loadSession = loadReceiverSession,
  publishState = publishReceiverState,
  publishCheckpoint = publishPlayCheckpoint,
  sendProtocolMessage,
  now = () => new Date(),
  makeMessageId = () => crypto.randomUUID(),
  retryCurrentItem = () => false,
  skipCurrentItem = () => false,
  telemetry = { captureError: () => undefined, metric: () => undefined },
}: ReceiverSessionRuntimeOptions) {
  let active: ActiveSession | null = null;
  let checkpoint: ActiveCheckpoint | null = null;
  let loadGeneration = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  let stateWrites = Promise.resolve();
  let checkpointWrites = Promise.resolve();
  let mediaAttempts = 0;
  let consecutiveFailedItems = 0;

  function messageBase() {
    return {
      version: CAST_PROTOCOL_VERSION,
      messageId: makeMessageId(),
    } as const;
  }

  function sendStatus(error?: CastReceiverError) {
    if (!active) return;
    const snapshot = store.getSnapshot();
    const progress = store.progress.getSnapshot();
    const message: CastReceiverStatusMessage = {
      ...messageBase(),
      type: "receiver.status",
      sessionId: active.sessionId,
      queueRevision: snapshot.queueRevision,
      stateSeq: snapshot.stateSeq,
      currentIndex: snapshot.currentIndex,
      currentTime: progress.currentTime,
      playerState: playerStateForPhase(snapshot.phase),
      consecutiveFailures: consecutiveFailedItems,
      ...(error ? { error } : {}),
    };
    sendProtocolMessage(message);
  }

  function sendQueueSnapshot(
    session: ReceiverSession,
    reason: CastQueueSnapshotMessage["reason"] = "reconnect",
  ) {
    const message: CastQueueSnapshotMessage = {
      ...messageBase(),
      type: "queue.snapshot",
      sessionId: session.sessionId,
      reason,
      queue: session.queue,
    };
    sendProtocolMessage(message);
  }

  function beginCheckpoint(itemId: string, position: number) {
    const timestamp = now();
    checkpoint = {
      itemId,
      startedAt: timestamp,
      lastObservedAt: timestamp,
      lastPosition: position,
      playedSeconds: 0,
    };
  }

  function accrueCheckpoint(position: number) {
    if (!checkpoint) return;
    const timestamp = now();
    if (store.getSnapshot().phase === "playing") {
      const wallDelta = Math.max(
        0,
        (timestamp.getTime() - checkpoint.lastObservedAt.getTime()) / 1_000,
      );
      const mediaDelta = Math.max(0, position - checkpoint.lastPosition);
      checkpoint.playedSeconds += Math.min(wallDelta, mediaDelta, 15);
    }
    checkpoint.lastObservedAt = timestamp;
    checkpoint.lastPosition = position;
  }

  function finishCheckpoint(completed: boolean) {
    if (!active || !checkpoint) return;
    const ending = checkpoint;
    checkpoint = null;
    const item = store
      .getSnapshot()
      .items.find((candidate) => candidate.itemId === ending.itemId);
    const duration = item?.duration;
    const completionRatio = duration
      ? Math.min(1, ending.playedSeconds / duration)
      : undefined;
    if (ending.playedSeconds <= 0 && !completed) return;
    const endedAt = now();
    const payload: PlayCheckpoint = {
      clientEventId: `${active.sessionId}:${
        ending.itemId
      }:${ending.startedAt.getTime()}`,
      itemId: ending.itemId,
      startedAt: ending.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      playedSeconds: Math.round(ending.playedSeconds * 1000) / 1000,
      ...(duration ? { trackDurationSeconds: duration } : {}),
      ...(completionRatio === undefined ? {} : { completionRatio }),
      wasSkipped: !completed,
      wasCompleted: completed,
    };
    const bootstrapUrl = active.bootstrapUrl;
    checkpointWrites = checkpointWrites
      .then(() => publishCheckpoint(bootstrapUrl, payload))
      .catch(() => undefined);
  }

  async function load(data: CrateLoadData): Promise<void> {
    const generation = ++loadGeneration;
    store.dispatch({ type: "load-started", sessionId: data.sessionId });
    try {
      const session = await loadSession(data.bootstrapUrl, data.sessionId);
      if (generation !== loadGeneration) return;
      active = { bootstrapUrl: data.bootstrapUrl, sessionId: data.sessionId };
      store.dispatch({
        type: "session-loaded",
        appearance: session.appearance,
        queue: session.queue,
      });
      const current = session.queue.items[session.queue.currentIndex];
      if (current) beginCheckpoint(current.itemId, session.queue.currentTime);
      sendQueueSnapshot(session);
      sendStatus();
      telemetry.metric("receiver.session_load", { outcome: "success" });
    } catch (error) {
      if (generation !== loadGeneration) return;
      store.dispatch({
        type: "terminal-error",
        message: "Playback unavailable",
      });
      telemetry.metric("receiver.session_load", { outcome: "error" });
      telemetry.captureError(
        error instanceof Error ? error : new Error("CAST_SESSION_UNAVAILABLE"),
        "session_load",
      );
      sendStatus();
    }
  }

  async function refreshQueue(): Promise<void> {
    if (!active) return;
    const generation = loadGeneration;
    const activeAtStart = active;
    try {
      const session = await loadSession(
        activeAtStart.bootstrapUrl,
        activeAtStart.sessionId,
      );
      if (generation !== loadGeneration || active !== activeAtStart) return;
      if (session.queue.queueRevision < store.getSnapshot().queueRevision) {
        telemetry.metric("receiver.queue_conflict", {
          outcome: "stale_snapshot",
        });
        return;
      }
      if (session.queue.queueRevision === store.getSnapshot().queueRevision) {
        return;
      }
      const previousProgress = store.progress.getSnapshot();
      const previousItem =
        store.getSnapshot().items[store.getSnapshot().currentIndex];
      store.dispatch({
        type: "session-loaded",
        appearance: session.appearance,
        queue: session.queue,
      });
      const nextItem = session.queue.items[session.queue.currentIndex];
      if (previousItem?.itemId === nextItem?.itemId) {
        store.progress.set({
          currentTime: previousProgress.currentTime,
          duration: nextItem?.duration ?? previousProgress.duration,
        });
      } else {
        accrueCheckpoint(previousProgress.currentTime);
        finishCheckpoint(false);
        if (nextItem)
          beginCheckpoint(nextItem.itemId, session.queue.currentTime);
      }
      sendQueueSnapshot(session, "updated");
      sendStatus();
      telemetry.metric("receiver.queue_refresh", { outcome: "success" });
    } catch (error) {
      store.dispatch({
        type: "recovering",
        message: "Refreshing the Cast queue",
      });
      telemetry.metric("receiver.queue_refresh", { outcome: "error" });
      telemetry.captureError(
        error instanceof Error ? error : new Error("CAST_QUEUE_REFRESH_FAILED"),
        "queue_refresh",
      );
      sendStatus();
    }
  }

  function currentItem(itemId: string) {
    const snapshot = store.getSnapshot();
    const previous = snapshot.items[snapshot.currentIndex];
    if (previous?.itemId === itemId) return;
    accrueCheckpoint(store.progress.getSnapshot().currentTime);
    const completed = Boolean(
      previous?.duration &&
        store.progress.getSnapshot().currentTime >= previous.duration * 0.9,
    );
    finishCheckpoint(completed);
    store.dispatch({ type: "current-item", itemId });
    const next = store.getSnapshot().items[store.getSnapshot().currentIndex];
    store.progress.set({ currentTime: 0, duration: next?.duration ?? 0 });
    if (next?.itemId === itemId) beginCheckpoint(itemId, 0);
    mediaAttempts = 0;
    void flushState();
  }

  function playerState(state: CastPlayerState) {
    accrueCheckpoint(store.progress.getSnapshot().currentTime);
    store.dispatch({ type: "player-state", state });
    if (state === "PLAYING") {
      mediaAttempts = 0;
      consecutiveFailedItems = 0;
    }
    sendStatus();
  }

  function mediaError() {
    mediaAttempts += 1;
    const itemId =
      store.getSnapshot().items[store.getSnapshot().currentIndex]?.itemId;
    if (mediaAttempts <= 2 && retryCurrentItem()) {
      telemetry.metric("receiver.media_retry", {
        attempt: mediaAttempts,
        outcome: "retry",
      });
      store.dispatch({ type: "recovering", message: "Retrying media" });
      sendStatus({
        code: "MEDIA_RETRYING",
        recoverable: true,
        ...(itemId ? { itemId } : {}),
        attempt: mediaAttempts,
      });
      return;
    }

    mediaAttempts = 0;
    consecutiveFailedItems += 1;
    accrueCheckpoint(store.progress.getSnapshot().currentTime);
    finishCheckpoint(false);
    const canSkip = consecutiveFailedItems < 3 && skipCurrentItem();
    if (canSkip) {
      telemetry.metric("receiver.media_skip", { outcome: "skip" });
      store.dispatch({
        type: "recovering",
        message: "Skipping unavailable media",
      });
      sendStatus({
        code: "MEDIA_FAILED",
        recoverable: true,
        ...(itemId ? { itemId } : {}),
        attempt: 3,
      });
      return;
    }
    store.dispatch({
      type: "terminal-error",
      message: "Unable to play this item",
    });
    telemetry.metric("receiver.media_terminal", { outcome: "error" });
    sendStatus({
      code: "MEDIA_FAILED",
      recoverable: false,
      ...(itemId ? { itemId } : {}),
      attempt: 3,
    });
  }

  function progress(value: { currentTime: number; duration: number }) {
    accrueCheckpoint(value.currentTime);
    store.progress.set(value);
  }

  function flushState(): Promise<void> {
    if (!active) return Promise.resolve();
    const snapshot = store.getSnapshot();
    const progress = store.progress.getSnapshot();
    const nextStateSeq = snapshot.stateSeq + 1;
    const update = {
      stateSeq: nextStateSeq,
      currentIndex: snapshot.currentIndex,
      currentTime: progress.currentTime,
    };
    const bootstrapUrl = active.bootstrapUrl;
    store.dispatch({ type: "state-seq", stateSeq: nextStateSeq });
    sendStatus();
    stateWrites = stateWrites
      .catch(() => undefined)
      .then(() => publishState(bootstrapUrl, update));
    return stateWrites;
  }

  function start() {
    if (interval) return;
    sendProtocolMessage({
      ...messageBase(),
      type: "receiver.ready",
      capabilities: ["queue", "checkpoint", "receiver-state", "spectrum"],
    });
    interval = setInterval(() => {
      void flushState().catch(() => undefined);
    }, STATE_INTERVAL_MS);
  }

  function stop() {
    loadGeneration += 1;
    if (interval) clearInterval(interval);
    interval = null;
    accrueCheckpoint(store.progress.getSnapshot().currentTime);
    finishCheckpoint(false);
    active = null;
  }

  return {
    currentItem,
    drain: () =>
      Promise.all([stateWrites, checkpointWrites]).then(() => undefined),
    flushState,
    load,
    mediaError,
    playerState,
    progress,
    refreshQueue,
    start,
    stop,
  };
}
