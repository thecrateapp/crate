import type { CastPlayerState, CastQueueItem } from "@crate/cast-protocol";

export type ReceiverPhase =
  | "buffering"
  | "error"
  | "idle"
  | "loading"
  | "paused"
  | "playing"
  | "recovering";

export interface ReceiverSnapshot {
  currentIndex: number;
  items: CastQueueItem[];
  message: string | null;
  phase: ReceiverPhase;
  queueRevision: number;
  sessionId: string | null;
}

export interface ReceiverProgress {
  currentTime: number;
  duration: number;
}

export type ReceiverAction =
  | { type: "load-started"; sessionId: string }
  | { type: "player-state"; state: CastPlayerState }
  | {
      type: "queue-loaded";
      queueRevision: number;
      currentIndex: number;
      items: CastQueueItem[];
    }
  | { type: "recovering"; message: string }
  | { type: "terminal-error"; message: string };

function phaseForPlayerState(state: CastPlayerState): ReceiverPhase {
  return {
    BUFFERING: "buffering",
    IDLE: "idle",
    PAUSED: "paused",
    PLAYING: "playing",
    RECOVERING: "recovering",
  }[state] as ReceiverPhase;
}

function reduce(
  snapshot: ReceiverSnapshot,
  action: ReceiverAction,
): ReceiverSnapshot {
  if (action.type === "load-started") {
    return {
      ...snapshot,
      message: null,
      phase: "loading",
      sessionId: action.sessionId,
    };
  }
  if (action.type === "player-state") {
    const phase = phaseForPlayerState(action.state);
    return phase === snapshot.phase
      ? snapshot
      : { ...snapshot, message: null, phase };
  }
  if (action.type === "queue-loaded") {
    return {
      ...snapshot,
      currentIndex: action.currentIndex,
      items: action.items,
      queueRevision: action.queueRevision,
    };
  }
  if (action.type === "recovering") {
    return { ...snapshot, message: action.message, phase: "recovering" };
  }
  return { ...snapshot, message: action.message, phase: "error" };
}

function createProgressChannel() {
  let snapshot: ReceiverProgress = { currentTime: 0, duration: 0 };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    set(next: ReceiverProgress) {
      if (
        next.currentTime === snapshot.currentTime &&
        next.duration === snapshot.duration
      ) {
        return;
      }
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createReceiverStore() {
  let snapshot: ReceiverSnapshot = {
    currentIndex: 0,
    items: [],
    message: null,
    phase: "idle",
    queueRevision: 0,
    sessionId: null,
  };
  const listeners = new Set<() => void>();
  return {
    progress: createProgressChannel(),
    getSnapshot: () => snapshot,
    dispatch(action: ReceiverAction) {
      const next = reduce(snapshot, action);
      if (next === snapshot) return;
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type ReceiverStore = ReturnType<typeof createReceiverStore>;
