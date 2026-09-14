import { registerPlugin } from "@capacitor/core";

import { api } from "@/lib/api";
import { isNative } from "@/lib/capacitor-runtime";
import {
  buildCastTicketRequest,
  buildNativePayload,
  buildWebLoadRequest,
  DEFAULT_CAST_TARGET_ID,
  resolveCastArtworkUrl,
  resolveCastMedia,
} from "./cast-sender-media";
import type {
  CastSenderCapabilities,
  CastPlaybackState,
  CastSession,
  CastStartPayload,
  CastStartResult,
  CastTicketResponse,
  CastWindow,
  ChromeCastMedia,
  ChromeCastNamespace,
  NativeCastPlugin,
} from "./cast-sender-types";

export type {
  CastPlaybackState,
  CastSenderCapabilities,
  CastStartPayload,
  CastStartResult,
  CastTicketRequest,
} from "./cast-sender-types";
export { buildCastTicketRequest } from "./cast-sender-media";

const CAST_SENDER_SCRIPT =
  "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
const CAST_SESSION_CHANGED_EVENT = "crate:cast-session-changed";

let webCastReady: Promise<boolean> | null = null;
let webCastInitialized = false;
const observedWebCastContexts = new WeakSet<object>();
let nativeCast: NativeCastPlugin | null = null;
let nativeCastSessionActive = false;
let nativeCastSessionGeneration = 0;

function emitCastSessionChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CAST_SESSION_CHANGED_EVENT));
  }
}

export function onCastSessionChanged(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(CAST_SESSION_CHANGED_EVENT, listener);
  return () => window.removeEventListener(CAST_SESSION_CHANGED_EVENT, listener);
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function currentWebCastPlaybackState(
  media: ChromeCastMedia | null = currentWebCastMedia(),
): CastPlaybackState | null {
  if (!media || !currentWebCastSession()) return null;
  const playerState = String(media.playerState || "").toUpperCase();
  const estimatedTime = media.getEstimatedTime?.();
  const currentTime = finiteNonNegative(estimatedTime ?? media.currentTime);
  const duration = finiteNonNegative(media.media?.duration ?? media.duration);
  const volume = media.volume?.level;
  return {
    active: true,
    currentTime: duration > 0 ? Math.min(currentTime, duration) : currentTime,
    duration,
    isBuffering: playerState === "BUFFERING",
    isPlaying: playerState === "PLAYING",
    volume:
      typeof volume === "number" && Number.isFinite(volume)
        ? Math.max(0, Math.min(1, volume))
        : undefined,
  };
}

export function subscribeCastPlaybackState(
  listener: (state: CastPlaybackState) => void,
): () => void {
  if (typeof window === "undefined" || isNative) return () => undefined;

  let disposed = false;
  let timer: number | null = null;
  let observedMedia: ChromeCastMedia | null = null;

  const clearTimer = () => {
    if (timer === null) return;
    window.clearTimeout(timer);
    timer = null;
  };
  const bindMedia = (media: ChromeCastMedia | null) => {
    if (media === observedMedia) return;
    observedMedia?.removeUpdateListener?.(handleMediaUpdate);
    observedMedia = media;
    observedMedia?.addUpdateListener?.(handleMediaUpdate);
  };
  const publish = () => {
    if (disposed) return;
    clearTimer();
    const media = currentWebCastMedia();
    bindMedia(media);
    const state = currentWebCastPlaybackState(media);
    if (!state) return;
    listener(state);
    if (state.isPlaying) {
      timer = window.setTimeout(publish, 500);
    }
  };
  function handleMediaUpdate(isAlive: boolean) {
    if (!isAlive) bindMedia(null);
    publish();
  }

  const unsubscribeSession = onCastSessionChanged(publish);
  publish();

  return () => {
    disposed = true;
    clearTimer();
    bindMedia(null);
    unsubscribeSession();
  };
}

function setAuthoritativeNativeCastSession(active: boolean): void {
  nativeCastSessionGeneration += 1;
  nativeCastSessionActive = active;
}

function applyNativeCastSuccess(
  result: CastStartResult,
  startedAtGeneration: number,
): void {
  if (result.ok && nativeCastSessionGeneration === startedAtGeneration) {
    nativeCastSessionGeneration += 1;
    nativeCastSessionActive = true;
  }
}

function getNativeCast(): NativeCastPlugin {
  if (!nativeCast) {
    nativeCast = registerPlugin<NativeCastPlugin>("CrateCast");
    // The native side ends a Cast session for reasons we never asked for
    // (receiver app closed remotely, TV turned off, the route dropping) —
    // without this, nativeCastSessionActive only ever moved in response to
    // a command *we* issued, so the first play/pause after an external
    // disconnect silently no-op'd against a session that no longer exists.
    void nativeCast.addListener("sessionChanged", (event) => {
      setAuthoritativeNativeCastSession(event.active);
      emitCastSessionChanged();
    });
  }
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
  const context = castFramework.CastContext.getInstance();
  if (
    context.addEventListener &&
    castFramework.CastContextEventType &&
    !observedWebCastContexts.has(context)
  ) {
    observedWebCastContexts.add(context);
    context.addEventListener(
      castFramework.CastContextEventType.CAST_STATE_CHANGED,
      emitCastSessionChanged,
    );
    context.addEventListener(
      castFramework.CastContextEventType.SESSION_STATE_CHANGED,
      emitCastSessionChanged,
    );
  }
  if (webCastInitialized) return true;

  context.setOptions({
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

  const ready = new Promise<boolean>((resolve) => {
    let settled = false;
    let script: HTMLScriptElement | null = null;
    const timeout = webWindow.setTimeout(() => finish(false), 6000);

    function finish(available: boolean) {
      if (settled) return;
      settled = true;
      webWindow.clearTimeout(timeout);
      if (!available) script?.remove();
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
    if (existingScript) {
      existingScript.addEventListener(
        "load",
        () => finish(initializeWebCastContext()),
        { once: true },
      );
      existingScript.addEventListener("error", () => finish(false), {
        once: true,
      });
      script = existingScript;
      return;
    }

    script = document.createElement("script");
    script.async = true;
    script.src = CAST_SENDER_SCRIPT;
    script.onerror = () => finish(false);
    document.head.appendChild(script);
  });

  webCastReady = ready.then((available) => {
    if (!available) webCastReady = null;
    return available;
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

async function getNativeCastCapabilities(): Promise<CastSenderCapabilities> {
  const startedAtGeneration = nativeCastSessionGeneration;
  try {
    const capabilities = await getNativeCast().getCapabilities();
    // This is the freshest read of the native session state we ever get —
    // sync our local flag from it, since a session can end natively
    // (receiver disconnect before the plugin is registered/listening,
    // app restart, etc.) without a `sessionChanged` event ever reaching us.
    if (nativeCastSessionGeneration === startedAtGeneration) {
      setAuthoritativeNativeCastSession(Boolean(capabilities.activeSession));
    }
    return {
      platform: "native",
      visible: capabilities.visible,
      available: capabilities.available,
      activeSession: nativeCastSessionActive,
      targetName: capabilities.targetName,
      reason: capabilities.reason,
    };
  } catch {
    return {
      platform: "native",
      visible: false,
      available: false,
      activeSession: false,
      reason: "Native Cast sender is not installed in this build.",
    };
  }
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

  const currentWindow = castWindow();
  const castFramework = currentWindow?.cast?.framework;
  const context = castFramework?.CastContext.getInstance();
  const session = context?.getCurrentSession() ?? null;
  const castState = context?.getCastState?.();
  const noDevicesState = castFramework?.CastState?.NO_DEVICES_AVAILABLE;
  const receiverAvailable =
    Boolean(session) || !noDevicesState || castState !== noDevicesState;
  return {
    platform: "web",
    visible: true,
    available: receiverAvailable,
    activeSession: Boolean(session),
    targetName: castSessionName(session),
    reason: receiverAvailable
      ? undefined
      : "No Cast receivers found on this network.",
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
      const startedAtGeneration = nativeCastSessionGeneration;
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
      // A successful command proves the session is still alive — "stop"
      // only stops the receiver's current media, it doesn't end the Cast
      // session, and the same logic applies to any command. A *failed*
      // command does not prove the opposite: a transient pause/seek/
      // volume rejection isn't a disconnect, so only ever move this flag
      // toward "active" here. "Inactive" comes exclusively from the
      // authoritative "sessionChanged" listener (see getNativeCast) or a
      // fresh getCapabilities() read — otherwise a command that merely
      // failed would stomp over a more recent, real disconnect signal, or
      // report "no session" while the device is still fully connected.
      applyNativeCastSuccess(result, startedAtGeneration);
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

export async function endCastSession(): Promise<CastStartResult> {
  if (isNative) {
    try {
      const result = await getNativeCast().endSession();
      if (result.ok) setAuthoritativeNativeCastSession(false);
      if (result.ok) emitCastSessionChanged();
      return result;
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Could not end Cast session.",
      };
    }
  }

  try {
    const context = castWindow()?.cast?.framework.CastContext.getInstance();
    if (!context?.getCurrentSession()) return { ok: true };
    context.endCurrentSession(true);
    emitCastSessionChanged();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not end Cast session.",
    };
  }
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
    const webSession = isNative ? null : await requestWebCastSession();
    if (!isNative && !webSession) {
      return { ok: false, message: "Could not open the Cast device picker." };
    }

    const ticket = await api<CastTicketResponse>(
      "/api/me/cast/tickets",
      "POST",
      request,
    );
    const media = await resolveCastMedia(ticket);
    const artworkUrl = await resolveCastArtworkUrl(
      payload.track.albumCover,
      media.stream_url || ticket.stream_url,
    );

    if (isNative) {
      const startedAtGeneration = nativeCastSessionGeneration;
      const result = await getNativeCast().requestSession(
        buildNativePayload(ticket, media, payload, artworkUrl),
      );
      applyNativeCastSuccess(result, startedAtGeneration);
      return result;
    }

    const session = webSession;
    const chromeCast = castWindow()?.chrome?.cast;
    const loadRequest = chromeCast
      ? buildWebLoadRequest(ticket, media, payload, chromeCast, artworkUrl)
      : null;
    if (!session || !loadRequest) {
      return { ok: false, message: "Could not open the Cast device picker." };
    }
    await session.loadMedia(loadRequest);
    nativeCastSessionActive = false;
    emitCastSessionChanged();
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
