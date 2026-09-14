import type { PluginListenerHandle } from "@capacitor/core";

import type { Track } from "@/contexts/player-types";

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
}

export interface CastStartPayload {
  track: Track;
  currentTime?: number;
  targetDeviceId?: string;
}

export interface CastStartResult {
  ok: boolean;
  message?: string;
  targetName?: string;
}

export interface CastPlaybackState {
  active: boolean;
  currentTime: number;
  duration: number;
  isBuffering: boolean;
  isPlaying: boolean;
  volume?: number;
}

export interface NativeCastSessionChangedEvent {
  active: boolean;
}

export interface NativeCastPlugin {
  getCapabilities(): Promise<CastSenderCapabilities>;
  requestSession(payload: NativeCastMediaPayload): Promise<CastStartResult>;
  play(): Promise<CastStartResult>;
  pause(): Promise<CastStartResult>;
  seek(payload: { currentTime: number }): Promise<CastStartResult>;
  setVolume(payload: { volume: number }): Promise<CastStartResult>;
  stop(): Promise<CastStartResult>;
  endSession(): Promise<CastStartResult>;
  addListener(
    eventName: "sessionChanged",
    listener: (event: NativeCastSessionChangedEvent) => void,
  ): Promise<PluginListenerHandle>;
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
  setVolume?(volume: number): Promise<unknown>;
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
    PauseRequest: new () => Record<string, never>;
    PlayRequest: new () => Record<string, never>;
    SeekRequest: new () => ChromeCastSeekRequest;
    StopRequest: new () => Record<string, never>;
    VolumeRequest: new (volume: ChromeCastVolume) => Record<string, unknown>;
  };
}

export interface ChromeCastMedia {
  currentTime?: number;
  duration?: number;
  media?: {
    duration?: number;
  };
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
