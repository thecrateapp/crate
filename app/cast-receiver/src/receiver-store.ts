import type {
  CastAppearance,
  CastPlayerState,
  CastQueueItem,
  CastQueueSnapshot,
} from "@crate/cast-protocol";

import { DEFAULT_RECEIVER_APPEARANCE } from "./appearance";

export type ReceiverPhase =
  | "buffering"
  | "error"
  | "idle"
  | "loading"
  | "paused"
  | "playing"
  | "recovering";

export interface ReceiverSnapshot {
  appearance: CastAppearance;
  currentIndex: number;
  items: CastQueueItem[];
  message: string | null;
  phase: ReceiverPhase;
  queueRevision: number;
  repeatMode: CastQueueSnapshot["repeatMode"];
  sessionId: string | null;
  shuffle: boolean;
  stateSeq: number;
}

export interface ReceiverProgress {
  currentTime: number;
  duration: number;
}

export type ReceiverAction =
  | { type: "load-started"; sessionId: string }
  | { type: "current-item"; itemId: string }
  | { type: "state-seq"; stateSeq: number }
  | { type: "player-state"; state: CastPlayerState }
  | {
      type: "queue-loaded";
      queueRevision: number;
      currentIndex: number;
      items: CastQueueItem[];
    }
  | {
      type: "session-loaded";
      appearance: CastAppearance;
      queue: CastQueueSnapshot;
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
  if (action.type === "current-item") {
    const currentIndex = snapshot.items.findIndex(
      (item) => item.itemId === action.itemId,
    );
    return currentIndex < 0 || currentIndex === snapshot.currentIndex
      ? snapshot
      : { ...snapshot, currentIndex };
  }
  if (action.type === "state-seq") {
    return action.stateSeq <= snapshot.stateSeq
      ? snapshot
      : { ...snapshot, stateSeq: action.stateSeq };
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
  if (action.type === "session-loaded") {
    return {
      ...snapshot,
      appearance: action.appearance,
      currentIndex: action.queue.currentIndex,
      items: action.queue.items,
      queueRevision: action.queue.queueRevision,
      repeatMode: action.queue.repeatMode,
      shuffle: action.queue.shuffle,
      stateSeq: action.queue.stateSeq,
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
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createReceiverStore() {
  let snapshot: ReceiverSnapshot = {
    appearance: DEFAULT_RECEIVER_APPEARANCE,
    currentIndex: 0,
    items: [],
    message: null,
    phase: "idle",
    queueRevision: 0,
    repeatMode: "off",
    sessionId: null,
    shuffle: false,
    stateSeq: 0,
  };
  const listeners = new Set<() => void>();
  const progress = createProgressChannel();
  return {
    progress,
    getSnapshot: () => snapshot,
    dispatch(action: ReceiverAction) {
      if (action.type === "session-loaded") {
        const item = action.queue.items[action.queue.currentIndex];
        progress.set({
          currentTime: action.queue.currentTime,
          duration: item?.duration ?? 0,
        });
      }
      const next = reduce(snapshot, action);
      if (next === snapshot) return;
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type ReceiverStore = ReturnType<typeof createReceiverStore>;
