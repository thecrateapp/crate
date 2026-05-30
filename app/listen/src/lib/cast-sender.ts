import { registerPlugin } from "@capacitor/core";

import type { Track } from "@/contexts/player-types";
import { api, apiUrl } from "@/lib/api";
import { isNative } from "@/lib/capacitor-runtime";

const CAST_SENDER_SCRIPT =
  "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

const DEFAULT_CAST_TARGET_ID = "google-cast:default";
const DEFAULT_RECEIVER_CAPABILITIES = {
  formats: ["mp3", "aac", "m4a"],
  content_types: ["audio/mpeg", "audio/aac", "audio/mp4"],
};

export interface CastTicketRequest {
  track_id?: number;
  track_entity_uid?: string;
  track_path?: string;
  purpose: "google_cast";
  target_device_id?: string;
  delivery: "auto";
  receiver_capabilities: Record<string, unknown>;
}

interface CastTicketResponse {
  stream_url: string;
  metadata_url: string;
  expires_at: string;
  delivery_policy: string;
}

interface CastMediaResponse {
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

interface NativeCastPlugin {
  getCapabilities(): Promise<CastSenderCapabilities>;
  requestSession(payload: NativeCastMediaPayload): Promise<CastStartResult>;
  play(): Promise<CastStartResult>;
  pause(): Promise<CastStartResult>;
  seek(payload: { currentTime: number }): Promise<CastStartResult>;
  setVolume(payload: { volume: number }): Promise<CastStartResult>;
  stop(): Promise<CastStartResult>;
}

interface NativeCastMediaPayload {
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

interface CastWindow extends Window {
  __onGCastApiAvailable?: (available: boolean) => void;
  cast?: CastNamespace;
  chrome?: ChromeCastWindow;
}

interface CastNamespace {
  framework: {
    CastContext: {
      getInstance(): CastContext;
    };
  };
}

interface CastContext {
  setOptions(options: {
    receiverApplicationId: string;
    autoJoinPolicy: string;
  }): void;
  getCurrentSession(): CastSession | null;
  requestSession(): Promise<CastSession>;
}

interface CastSession {
  getCastDevice?(): { friendlyName?: string } | null;
  getMediaSession?(): ChromeCastMedia | null;
  loadMedia(request: ChromeCastLoadRequest): Promise<unknown>;
  setVolume?(volume: number): Promise<unknown>;
}

interface ChromeCastWindow {
  cast?: ChromeCastNamespace;
}

interface ChromeCastNamespace {
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

interface ChromeCastMedia {
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

interface ChromeCastImage {
  url: string;
}

interface ChromeCastMediaInfo {
  customData?: unknown;
  duration?: number;
  metadata?: ChromeCastMusicMetadata;
}

interface ChromeCastLoadRequest {
  autoplay?: boolean;
  currentTime?: number;
}

interface ChromeCastSeekRequest {
  currentTime?: number;
}

interface ChromeCastMusicMetadata {
  albumName?: string;
  artist?: string;
  images?: ChromeCastImage[];
  title?: string;
}

interface ChromeCastVolume {
  level?: number;
  muted?: boolean;
}

let webCastReady: Promise<boolean> | null = null;
let webCastInitialized = false;
let nativeCast: NativeCastPlugin | null = null;
let nativeCastSessionActive = false;

function getNativeCast(): NativeCastPlugin {
  nativeCast ??= registerPlugin<NativeCastPlugin>("CrateCast");
  return nativeCast;
}

function castWindow(): CastWindow | null {
  if (typeof window === "undefined") return null;
  return window as CastWindow;
}

function isLikelyWebCastBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const hasChromeNamespace = Boolean(castWindow()?.chrome);
  return (
    hasChromeNamespace ||
    (/(Chrome|Chromium|Edg)\//.test(ua) && !/(CriOS|FxiOS)\//.test(ua))
  );
}

function initializeWebCastContext(): boolean {
  const currentWindow = castWindow();
  const castFramework = currentWindow?.cast?.framework;
  const chromeCast = currentWindow?.chrome?.cast;
  if (!castFramework || !chromeCast) return false;
  if (webCastInitialized) return true;

  castFramework.CastContext.getInstance().setOptions({
    receiverApplicationId: chromeCast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chromeCast.AutoJoinPolicy.ORIGIN_SCOPED,
  });
  webCastInitialized = true;
  return true;
}

function ensureWebCastFramework(): Promise<boolean> {
  const currentWindow = castWindow();
  if (!currentWindow || typeof document === "undefined") {
    return Promise.resolve(false);
  }
  const webWindow = currentWindow;
  if (initializeWebCastContext()) return Promise.resolve(true);
  if (!isLikelyWebCastBrowser()) return Promise.resolve(false);
  if (webCastReady) return webCastReady;

  webCastReady = new Promise((resolve) => {
    let settled = false;
    const timeout = webWindow.setTimeout(() => finish(false), 6000);

    function finish(available: boolean) {
      if (settled) return;
      settled = true;
      webWindow.clearTimeout(timeout);
      resolve(available && initializeWebCastContext());
    }

    const previousCallback = webWindow.__onGCastApiAvailable;
    webWindow.__onGCastApiAvailable = (available) => {
      previousCallback?.(available);
      finish(Boolean(available));
    };

    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${CAST_SENDER_SCRIPT}"]`,
    );
    if (existingScript) return;

    const script = document.createElement("script");
    script.async = true;
    script.src = CAST_SENDER_SCRIPT;
    script.onerror = () => finish(false);
    document.head.appendChild(script);
  });

  return webCastReady;
}

function currentWebCastSession(): CastSession | null {
  if (!initializeWebCastContext()) return null;
  return (
    castWindow()
      ?.cast?.framework.CastContext.getInstance()
      .getCurrentSession() ?? null
  );
}

function currentWebCastMedia(): ChromeCastMedia | null {
  return currentWebCastSession()?.getMediaSession?.() ?? null;
}

async function requestWebCastSession(): Promise<CastSession | null> {
  if (!initializeWebCastContext()) return null;
  const context = castWindow()?.cast?.framework.CastContext.getInstance();
  const currentSession = context?.getCurrentSession() ?? null;
  if (currentSession) return currentSession;
  return (await context?.requestSession()) ?? null;
}

function castSessionName(session: CastSession | null): string | undefined {
  return session?.getCastDevice?.()?.friendlyName || undefined;
}

function resolveWebCastMediaCommand(
  run: (
    media: ChromeCastMedia,
    chromeCast: ChromeCastNamespace,
    resolve: () => void,
    reject: (error: unknown) => void,
  ) => void,
): Promise<void> {
  const media = currentWebCastMedia();
  const chromeCast = castWindow()?.chrome?.cast;
  if (!media || !chromeCast) {
    return Promise.reject(new Error("No active Cast media session."));
  }
  return new Promise((resolve, reject) => {
    run(media, chromeCast, resolve, reject);
  });
}

function receiverArtworkUrl(
  url: string | null | undefined,
): string | undefined {
  if (!url) return undefined;
  if (
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("file:") ||
    url.startsWith("capacitor:")
  ) {
    return undefined;
  }
  if (url.startsWith("/api/")) return apiUrl(url);
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === "undefined") return undefined;
  try {
    return new URL(url, window.location.origin).href;
  } catch {
    return undefined;
  }
}

function mediaDurationSeconds(
  media: CastMediaResponse,
  track: Track,
): number | undefined {
  if (typeof media.duration_ms === "number" && media.duration_ms > 0) {
    return media.duration_ms / 1000;
  }
  if (typeof track.duration === "number" && track.duration > 0) {
    return track.duration;
  }
  return undefined;
}

async function resolveCastMedia(
  ticket: CastTicketResponse,
): Promise<CastMediaResponse> {
  const response = await fetch(ticket.metadata_url, {
    credentials: "omit",
  });
  if (response.status === 425) {
    throw new Error(
      "Receiver-safe audio is still preparing. Try again shortly.",
    );
  }
  if (!response.ok) {
    throw new Error("Could not prepare this track for Cast.");
  }
  return (await response.json()) as CastMediaResponse;
}

function buildNativePayload(
  ticket: CastTicketResponse,
  media: CastMediaResponse,
  payload: CastStartPayload,
): NativeCastMediaPayload {
  const track = payload.track;
  return {
    streamUrl: media.stream_url || ticket.stream_url,
    metadataUrl: ticket.metadata_url,
    contentType: media.content_type || "audio/mpeg",
    title: media.title || track.title,
    artist: media.artist || track.artist,
    album: media.album || track.album || "",
    artworkUrl: receiverArtworkUrl(track.albumCover),
    duration: mediaDurationSeconds(media, track),
    currentTime: payload.currentTime,
  };
}

function buildWebLoadRequest(
  ticket: CastTicketResponse,
  media: CastMediaResponse,
  payload: CastStartPayload,
): ChromeCastLoadRequest | null {
  const currentWindow = castWindow();
  const chromeCast = currentWindow?.chrome?.cast;
  if (!chromeCast) return null;

  const nativePayload = buildNativePayload(ticket, media, payload);
  const mediaInfo = new chromeCast.media.MediaInfo(
    nativePayload.streamUrl,
    nativePayload.contentType,
  );
  const metadata = new chromeCast.media.MusicTrackMediaMetadata();
  metadata.title = nativePayload.title;
  metadata.artist = nativePayload.artist;
  metadata.albumName = nativePayload.album;

  if (nativePayload.artworkUrl) {
    metadata.images = [new chromeCast.Image(nativePayload.artworkUrl)];
  }

  mediaInfo.metadata = metadata;
  mediaInfo.duration = nativePayload.duration;
  mediaInfo.customData = {
    metadataUrl: nativePayload.metadataUrl,
    delivery: media.delivery,
  };

  const request = new chromeCast.media.LoadRequest(mediaInfo);
  request.autoplay = true;
  request.currentTime = Math.max(0, Math.floor(payload.currentTime || 0));
  return request;
}

async function getNativeCastCapabilities(): Promise<CastSenderCapabilities> {
  try {
    const capabilities = await getNativeCast().getCapabilities();
    return {
      platform: "native",
      visible: true,
      available: capabilities.available,
      activeSession: Boolean(capabilities.activeSession),
      targetName: capabilities.targetName,
      reason: capabilities.reason,
    };
  } catch {
    return {
      platform: "native",
      visible: true,
      available: false,
      activeSession: false,
      reason: "Native Cast sender is not installed in this build.",
    };
  }
}

export function buildCastTicketRequest(
  track: Track,
  targetDeviceId: string = DEFAULT_CAST_TARGET_ID,
): CastTicketRequest | null {
  const request: CastTicketRequest = {
    purpose: "google_cast",
    target_device_id: targetDeviceId,
    delivery: "auto",
    receiver_capabilities: DEFAULT_RECEIVER_CAPABILITIES,
  };

  if (typeof track.libraryTrackId === "number" && track.libraryTrackId > 0) {
    request.track_id = track.libraryTrackId;
    return request;
  }
  if (track.entityUid) {
    request.track_entity_uid = track.entityUid;
    return request;
  }
  if (track.path) {
    request.track_path = track.path;
    return request;
  }
  return null;
}

export async function getCastSenderCapabilities(): Promise<CastSenderCapabilities> {
  if (isNative) return getNativeCastCapabilities();
  const available = await ensureWebCastFramework();
  if (!available) {
    return {
      platform: isLikelyWebCastBrowser() ? "web" : "unsupported",
      visible: isLikelyWebCastBrowser(),
      available: false,
      activeSession: false,
      reason:
        "Google Cast sender requires Chrome, Edge, or the native app bridge.",
    };
  }

  const session = currentWebCastSession();
  return {
    platform: "web",
    visible: true,
    available: true,
    activeSession: Boolean(session),
    targetName: castSessionName(session),
  };
}

export function isCastSessionActive(): boolean {
  if (isNative) return nativeCastSessionActive;
  return Boolean(currentWebCastSession());
}

async function castControl(
  command: "pause" | "play" | "seek" | "setVolume" | "stop",
  payload: { currentTime?: number; volume?: number } = {},
): Promise<CastStartResult> {
  if (isNative) {
    try {
      let result: CastStartResult;
      const nativeCastPlugin = getNativeCast();
      if (command === "play") result = await nativeCastPlugin.play();
      else if (command === "pause") result = await nativeCastPlugin.pause();
      else if (command === "seek") {
        result = await nativeCastPlugin.seek({
          currentTime: Math.max(0, payload.currentTime || 0),
        });
      } else if (command === "setVolume") {
        result = await nativeCastPlugin.setVolume({
          volume: Math.max(0, Math.min(1, payload.volume ?? 1)),
        });
      } else result = await nativeCastPlugin.stop();
      nativeCastSessionActive = command === "stop" ? false : result.ok;
      return result;
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "Cast control failed.",
      };
    }
  }

  try {
    await resolveWebCastMediaCommand((media, chromeCast, resolve, reject) => {
      if (command === "play") {
        media.play(new chromeCast.media.PlayRequest(), resolve, reject);
        return;
      }
      if (command === "pause") {
        media.pause(new chromeCast.media.PauseRequest(), resolve, reject);
        return;
      }
      if (command === "seek") {
        const request = new chromeCast.media.SeekRequest();
        request.currentTime = Math.max(0, payload.currentTime || 0);
        media.seek(request, resolve, reject);
        return;
      }
      if (command === "setVolume") {
        const volume = new chromeCast.Volume(
          Math.max(0, Math.min(1, payload.volume ?? 1)),
          false,
        );
        media.setVolume(
          new chromeCast.media.VolumeRequest(volume),
          resolve,
          reject,
        );
        return;
      }
      media.stop(new chromeCast.media.StopRequest(), resolve, reject);
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Cast control failed.",
    };
  }
}

export function castPlay(): Promise<CastStartResult> {
  return castControl("play");
}

export function castPause(): Promise<CastStartResult> {
  return castControl("pause");
}

export function castSeek(currentTime: number): Promise<CastStartResult> {
  return castControl("seek", { currentTime });
}

export function castSetVolume(volume: number): Promise<CastStartResult> {
  return castControl("setVolume", { volume });
}

export function castStop(): Promise<CastStartResult> {
  return castControl("stop");
}

export async function startCastSession(
  payload: CastStartPayload,
): Promise<CastStartResult> {
  const request = buildCastTicketRequest(
    payload.track,
    payload.targetDeviceId || DEFAULT_CAST_TARGET_ID,
  );
  if (!request) {
    return {
      ok: false,
      message: "This track does not expose a Cast-capable library reference.",
    };
  }

  const capabilities = await getCastSenderCapabilities();
  if (!capabilities.available) {
    return {
      ok: false,
      message: capabilities.reason || "Google Cast is unavailable.",
    };
  }

  try {
    const ticket = await api<CastTicketResponse>(
      "/api/me/cast/tickets",
      "POST",
      request,
    );
    const media = await resolveCastMedia(ticket);

    if (isNative) {
      const result = await getNativeCast().requestSession(
        buildNativePayload(ticket, media, payload),
      );
      nativeCastSessionActive = result.ok;
      return result;
    }

    const session = await requestWebCastSession();
    const loadRequest = buildWebLoadRequest(ticket, media, payload);
    if (!session || !loadRequest) {
      return { ok: false, message: "Could not open the Cast device picker." };
    }
    await session.loadMedia(loadRequest);
    nativeCastSessionActive = false;
    const targetName = castSessionName(session);
    return {
      ok: true,
      targetName,
      message: targetName ? `Casting to ${targetName}.` : "Casting started.",
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Could not start Google Cast playback.",
    };
  }
}
