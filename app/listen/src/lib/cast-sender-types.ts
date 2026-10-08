import type { PluginListenerHandle } from "@capacitor/core";
import type {
  CastAppearance,
  CastReceiverStatusMessage,
} from "@crate/cast-protocol";

import type { RepeatMode, Track } from "@/contexts/player-types";

export interface CastTicketRequest {
  track_id?: number;
  track_entity_uid?: string;
  track_path?: string;
  purpose: "google_cast";
  target_device_id?: string;
  delivery: "auto";
  receiver_capabilities: Record<string, unknown>;
}

export interface CastTicketResponse {
  stream_url: string;
  metadata_url: string;
  expires_at: string;
  delivery_policy: string;
}

export interface CastMediaResponse {
  stream_url: string;
  title?: string;
  artist?: string;
  album?: string;
  duration_ms?: number | null;
  content_type?: string;
  delivery?: Record<string, unknown>;
}

export interface CastSenderCapabilities {
  platform: "native" | "unsupported" | "web";
  visible: boolean;
  available: boolean;
  activeSession: boolean;
  targetName?: string;
  reason?: string;
  receiverApplicationId?: string;
  sessionId?: string;
  bootstrapUrl?: string;
}

export interface CastStartPayload {
  track: Track;
  queue?: Track[];
  currentIndex?: number;
  currentTime?: number;
  repeatMode?: RepeatMode;
  shuffle?: boolean;
  appearance?: CastAppearance;
  targetDeviceId?: string;
}

export interface CastSessionQueueItemResponse {
  item_id: string;
  track_id?: number;
  track_entity_uid?: string;
  track_path?: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
  quality?: string;
  artwork_url?: string;
  content_type: string;
  stream_url: string;
  metadata_url: string;
}

export interface CastPlaybackSessionResponse {
  session_id: string;
  lease: string;
  bootstrap_url: string;
  receiver_application_id: string;
  queue: {
    revision: number;
    state_seq: number;
    current_index: number;
    current_time: number;
    repeat_mode: RepeatMode;
    shuffle: boolean;
    items: CastSessionQueueItemResponse[];
  };
}

export interface CastStartResult {
  ok: boolean;
  message?: string;
  targetName?: string;
}

export interface CastPlaybackState {
  active: boolean;
  currentIndex?: number;
  currentTime: number;
  duration: number;
  isBuffering: boolean;
  isPlaying: boolean;
  volume?: number;
}

export interface NativeCastSessionChangedEvent {
  active: boolean;
  sessionId?: string;
  bootstrapUrl?: string;
  targetName?: string;
}

export interface NativeCastQueueSnapshot {
  available: boolean;
  items: Array<{
    stableId: string;
    itemId: number;
  }>;
}

export type NativeCastPlaybackStateEvent = CastPlaybackState;

export interface NativeCastProtocolMessageEvent {
  namespace: string;
  message: string;
}

export interface NativeCastPlugin {
  getCapabilities(): Promise<CastSenderCapabilities>;
  requestSession(
    payload: NativeCastMediaPayload | NativeCastQueuePayload,
  ): Promise<CastStartResult>;
  play(): Promise<CastStartResult>;
  pause(): Promise<CastStartResult>;
  seek(payload: { currentTime: number }): Promise<CastStartResult>;
  setVolume(payload: { volume: number }): Promise<CastStartResult>;
  stop(): Promise<CastStartResult>;
  endSession(payload?: { stopCasting?: boolean }): Promise<CastStartResult>;
  getQueueSnapshot(): Promise<NativeCastQueueSnapshot>;
  queueInsert(payload: {
    items: NativeCastQueueItemPayload[];
    insertBefore?: number;
  }): Promise<CastStartResult>;
  queueRemove(payload: { itemIds: number[] }): Promise<CastStartResult>;
  queueReorder(payload: { itemIds: number[] }): Promise<CastStartResult>;
  queueSetRepeatMode(payload: {
    repeatMode: RepeatMode;
  }): Promise<CastStartResult>;
  queueNext(): Promise<CastStartResult>;
  queuePrevious(): Promise<CastStartResult>;
  queueJumpTo(payload: { index: number }): Promise<CastStartResult>;
  addListener(
    eventName: "sessionChanged",
    listener: (event: NativeCastSessionChangedEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "playbackState",
    listener: (event: NativeCastPlaybackStateEvent) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "protocolMessage",
    listener: (event: NativeCastProtocolMessageEvent) => void,
  ): Promise<PluginListenerHandle>;
}

export interface NativeCastQueueItemPayload {
  stableId: string;
  streamUrl: string;
  contentType: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl?: string;
  duration?: number;
  customData: {
    crateCast: {
      protocolVersion: 1;
      sessionId: string;
      bootstrapUrl: string;
      itemId: string;
    };
  };
}

export interface NativeCastQueuePayload {
  protocolVersion: 1;
  sessionId: string;
  bootstrapUrl: string;
  currentIndex: number;
  currentTime: number;
  repeatMode: RepeatMode;
  items: NativeCastQueueItemPayload[];
}

export interface NativeCastMediaPayload {
  streamUrl: string;
  metadataUrl: string;
  contentType: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl?: string;
  duration?: number;
  currentTime?: number;
}

export interface CastWindow extends Window {
  __onGCastApiAvailable?: (available: boolean) => void;
  cast?: CastNamespace;
  chrome?: ChromeCastWindow;
}

export interface CastNamespace {
  framework: {
    CastContext: {
      getInstance(): CastContext;
    };
    CastState?: {
      NO_DEVICES_AVAILABLE: string;
    };
    CastContextEventType?: {
      CAST_STATE_CHANGED: string;
      SESSION_STATE_CHANGED: string;
    };
  };
}

export interface CastContext {
  setOptions(options: {
    receiverApplicationId: string;
    autoJoinPolicy: string;
  }): void;
  getCurrentSession(): CastSession | null;
  getCastState?(): string;
  addEventListener?(
    eventType: string,
    listener: (event: unknown) => void,
  ): void;
  requestSession(): Promise<CastSession>;
  endCurrentSession(stopCasting: boolean): void;
}

export interface CastSession {
  getCastDevice?(): { friendlyName?: string } | null;
  getMediaSession?(): ChromeCastMedia | null;
  loadMedia(request: ChromeCastLoadRequest): Promise<unknown>;
  getSessionObj?(): ChromeCastSessionObject | null;
  setVolume?(volume: number): Promise<unknown>;
  addMessageListener?(
    namespace: string,
    listener: (namespace: string, message: string) => void,
  ): void;
  removeMessageListener?(
    namespace: string,
    listener: (namespace: string, message: string) => void,
  ): void;
}

export interface TimedCastReceiverStatus {
  message: CastReceiverStatusMessage;
  receivedAt: number;
}

export interface ChromeCastSessionObject {
  queueLoad(
    items: ChromeCastQueueItem[],
    repeatMode: string,
    startIndex: number,
    startTime: number,
    customData: unknown,
    success: () => void,
    error: (error: unknown) => void,
  ): void;
}

export interface ChromeCastWindow {
  cast?: ChromeCastNamespace;
}

export interface ChromeCastNamespace {
  AutoJoinPolicy: {
    ORIGIN_SCOPED: string;
  };
  Volume: new (level?: number, muted?: boolean) => ChromeCastVolume;
  Image: new (url: string) => ChromeCastImage;
  media: {
    DEFAULT_MEDIA_RECEIVER_APP_ID: string;
    LoadRequest: new (mediaInfo: ChromeCastMediaInfo) => ChromeCastLoadRequest;
    MediaInfo: new (
      contentId: string,
      contentType: string,
    ) => ChromeCastMediaInfo;
    MusicTrackMediaMetadata: new () => ChromeCastMusicMetadata;
    QueueItem: new (mediaInfo: ChromeCastMediaInfo) => ChromeCastQueueItem;
    QueueInsertItemsRequest: new (
      items: ChromeCastQueueItem[],
    ) => ChromeCastQueueInsertItemsRequest;
    QueueRemoveItemsRequest: new (
      itemIds: number[],
    ) => ChromeCastQueueRemoveItemsRequest;
    QueueReorderItemsRequest: new (
      itemIds: number[],
    ) => ChromeCastQueueReorderItemsRequest;
    RepeatMode: {
      OFF: string;
      ALL: string;
      SINGLE: string;
    };
    PauseRequest: new () => Record<string, never>;
    PlayRequest: new () => Record<string, never>;
    SeekRequest: new () => ChromeCastSeekRequest;
    StopRequest: new () => Record<string, never>;
    VolumeRequest: new (volume: ChromeCastVolume) => Record<string, unknown>;
  };
}

export interface ChromeCastQueueItem {
  autoplay?: boolean;
  itemId?: number;
  media: ChromeCastMediaInfo;
  startTime?: number;
}

export interface ChromeCastQueueInsertItemsRequest {
  insertBefore?: number;
  items: ChromeCastQueueItem[];
}

export interface ChromeCastQueueRemoveItemsRequest {
  itemIds: number[];
}

export interface ChromeCastQueueReorderItemsRequest {
  insertBefore?: number;
  itemIds: number[];
}

export interface WebCastQueueLoad {
  items: ChromeCastQueueItem[];
  repeatMode: string;
  startIndex: number;
  startTime: number;
  customData: { crateCast: { protocolVersion: 1; sessionId: string } };
}

export interface ChromeCastMedia {
  currentItemId?: number;
  currentTime?: number;
  duration?: number;
  media?: {
    customData?: unknown;
    duration?: number;
  };
  items?: ChromeCastQueueItem[];
  playerState?: string;
  volume?: ChromeCastVolume;
  getEstimatedTime?(): number;
  addUpdateListener?(listener: (isAlive: boolean) => void): void;
  removeUpdateListener?(listener: (isAlive: boolean) => void): void;
  pause(
    request: Record<string, never>,
    success: () => void,
    error: (error: unknown) => void,
  ): void;
  play(
    request: Record<string, never>,
    success: () => void,
    error: (error: unknown) => void,
  ): void;
  queueJumpToItem(
    itemId: number,
    success: () => void,
    error: (error: unknown) => void,
  ): void;
  queueNext(success: () => void, error: (error: unknown) => void): void;
  queuePrev(success: () => void, error: (error: unknown) => void): void;
  queueInsertItems(
    request: ChromeCastQueueInsertItemsRequest,
    success: () => void,
    error: (error: unknown) => void,
  ): void;
  queueRemoveItems(
    request: ChromeCastQueueRemoveItemsRequest,
    success: () => void,
    error: (error: unknown) => void,
  ): void;
  queueReorderItems(
    request: ChromeCastQueueReorderItemsRequest,
    success: () => void,
    error: (error: unknown) => void,
  ): void;
  queueSetRepeatMode(
    repeatMode: string,
    success: () => void,
    error: (error: unknown) => void,
  ): void;
  seek(
    request: ChromeCastSeekRequest,
    success: () => void,
    error: (error: unknown) => void,
  ): void;
  setVolume(
    request: Record<string, unknown>,
    success: () => void,
    error: (error: unknown) => void,
  ): void;
  stop(
    request: Record<string, never>,
    success: () => void,
    error: (error: unknown) => void,
  ): void;
}

export interface ChromeCastImage {
  height?: number;
  url: string;
  width?: number;
}

export interface ChromeCastMediaInfo {
  customData?: unknown;
  duration?: number;
  metadata?: ChromeCastMusicMetadata;
}

export interface ChromeCastLoadRequest {
  autoplay?: boolean;
  currentTime?: number;
}

export interface ChromeCastSeekRequest {
  currentTime?: number;
}

export interface ChromeCastMusicMetadata {
  albumName?: string;
  artist?: string;
  images?: ChromeCastImage[];
  title?: string;
}

export interface ChromeCastVolume {
  level?: number;
  muted?: boolean;
}
