export type EngineRepeatMode = "off" | "one" | "all";
export type EnginePlaybackState = "idle" | "buffering" | "ready" | "playing" | "paused" | "ended";
export type EngineTransitionType = "gapless" | "crossfade" | "manual-skip" | "seek";

export interface EngineTrack {
  id: string;
  url: string;
  title: string;
  artist: string;
  album?: string;
  artwork?: string;
  durationMs?: number;
  storageId?: string;
  entityUid?: string;
  sourcePath?: string;
  offlineUrl?: string;
  eqGains?: number[];
}

export interface EngineQueueSnapshot {
  revision: string;
  tracks: EngineTrack[];
  currentIndex: number;
  positionMs: number;
  autoplay: boolean;
  repeat: EngineRepeatMode;
  crossfadeMs: number;
  volume: number;
}

export interface EngineState {
  revision: string;
  nativeTimeMs?: number;
  playbackState: EnginePlaybackState;
  isPlaying: boolean;
  index: number;
  positionMs: number;
  durationMs: number;
  queueSize: number;
  crossfadeMs: number;
  eqEnabled: boolean;
}

export interface EnginePositionEvent {
  revision: string;
  nativeTimeMs?: number;
  trackId?: string;
  index: number;
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
}

export interface EngineTransitionEvent {
  revision: string;
  type: EngineTransitionType;
  outgoingTrackId?: string;
  incomingTrackId?: string;
  outgoingIndex?: number;
  incomingIndex?: number;
  durationMs?: number;
  startedAtNativeMs?: number;
  progress?: number;
  outgoingVolume?: number;
  incomingVolume?: number;
  finalIndex?: number;
}

export interface EngineErrorEvent {
  revision: string;
  code?: number;
  message: string;
  trackId?: string;
  url?: string;
  cause?: string;
  causeMessage?: string;
  httpStatus?: number;
}

export interface EngineEventMap {
  ready: EngineState;
  stateChanged: EngineState;
  positionChanged: EnginePositionEvent;
  playEventCheckpoint: EnginePositionEvent & { checkpointMs?: number };
  trackChanged: EnginePositionEvent & { reason?: string };
  transitionStarted: EngineTransitionEvent;
  transitionProgress: EngineTransitionEvent;
  transitionEnded: EngineTransitionEvent;
  bufferingChanged: { revision: string; isBuffering: boolean };
  queueEnded: { revision: string };
  nearQueueEnd: { revision: string; remainingTracks: number };
  error: EngineErrorEvent;
}

export type EngineEventName = keyof EngineEventMap;
export type EngineEventListener<K extends EngineEventName> = (event: EngineEventMap[K]) => void;

export interface PlaybackEngine {
  loadQueue(snapshot: EngineQueueSnapshot): Promise<EngineState | void>;
  play(): Promise<EngineState | void>;
  pause(): Promise<EngineState | void>;
  stop(): Promise<EngineState | void>;
  seekTo(positionMs: number): Promise<EngineState | void>;
  next(): Promise<EngineState | void>;
  previous(): Promise<EngineState | void>;
  jumpTo(index: number, autoplay: boolean): Promise<EngineState | void>;
  appendTracks(tracks: EngineTrack[]): Promise<EngineState | void>;
  insertTrack(index: number, track: EngineTrack): Promise<EngineState | void>;
  removeTrack(index: number): Promise<EngineState | void>;
  reorderTrack(fromIndex: number, toIndex: number): Promise<EngineState | void>;
  setRepeat(repeat: EngineRepeatMode): Promise<EngineState | void>;
  setCrossfadeMs(ms: number): Promise<EngineState | void>;
  setVolume(volume: number): Promise<EngineState | void>;
  setPlaybackRate(rate: number): Promise<EngineState | void>;
  setEq(enabled: boolean, gains: number[], rampMs?: number): Promise<EngineState | void>;
  getState(): Promise<EngineState | null>;
  drainEvents(): Promise<Array<{ event: EngineEventName; payload: EngineEventMap[EngineEventName] }>>;
  on<K extends EngineEventName>(event: K, listener: EngineEventListener<K>): Promise<() => void>;
  destroy(): Promise<void>;
}

export function createQueueRevision(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
