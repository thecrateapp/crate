import { registerPlugin } from "@capacitor/core";
import {
  CAST_PROTOCOL_NAMESPACE,
  parseCastProtocolMessage,
} from "@crate/cast-protocol";

import { ApiError, api } from "@/lib/api";
import type { RepeatMode, Track } from "@/contexts/player-types";
import { isNative } from "@/lib/capacitor-runtime";
import {
  buildCastTicketRequest,
  buildNativePayload,
  buildWebLoadRequest,
  buildWebQueueLoad,
  DEFAULT_CAST_TARGET_ID,
  resolveCastArtworkUrl,
  resolveCastMedia,
} from "./cast-sender-media";
import {
  buildCastQueueUpdateRequest,
  createCastPlaybackSession,
  loadScopedCastPlaybackSession,
  revokeCastPlaybackSession,
  updateCastPlaybackSession,
  type CastSessionQueueItemRequest,
} from "./cast-session-client";
import type {
  CastSenderCapabilities,
  CastPlaybackSessionResponse,
  CastPlaybackState,
  CastSession,
  CastStartPayload,
  CastStartResult,
  CastTicketResponse,
  CastWindow,
  ChromeCastMedia,
  ChromeCastNamespace,
  NativeCastPlugin,
  TimedCastReceiverStatus,
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
let webCastInitializedReceiverId: string | null = null;
const observedWebCastContexts = new WeakSet<object>();
let nativeCast: NativeCastPlugin | null = null;
let nativeCastSessionActive = false;
let nativeCastSessionGeneration = 0;
let activeCrateCastSessionId: string | null = null;
let activeCrateCastBootstrapUrl: string | null = null;
let activeCrateCastQueue: CastPlaybackSessionResponse["queue"] | null = null;
let castQueueWriteTail: Promise<void> = Promise.resolve();

interface CustomCastQueueUpdate {
  currentIndex: number;
  queue: Track[];
  repeatMode: RepeatMode;
  shuffle: boolean;
}

function customReceiverApplicationId(): string | null {
  if (import.meta.env.VITE_CAST_CUSTOM_RECEIVER_ENABLED !== "true") return null;
  const appId = import.meta.env.VITE_CAST_RECEIVER_APP_ID?.trim();
  return appId && /^[a-z0-9]{8}$/i.test(appId) ? appId : null;
}

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
  receiverStatus?: TimedCastReceiverStatus | null,
): CastPlaybackState | null {
  if (!media || !currentWebCastSession()) return null;
  const playerState = String(media.playerState || "").toUpperCase();
  const estimatedTime = media.getEstimatedTime?.();
  const status = receiverStatus?.message;
  const receiverTime = status
    ? status.currentTime +
      (status.playerState === "PLAYING"
        ? Math.max(0, Date.now() - receiverStatus.receivedAt) / 1_000
        : 0)
    : undefined;
  const currentTime = finiteNonNegative(
    receiverTime ?? estimatedTime ?? media.currentTime,
  );
  const duration = finiteNonNegative(media.media?.duration ?? media.duration);
  const volume = media.volume?.level;
  const cafCurrentIndex = media.items?.findIndex(
    (item) => item.itemId === media.currentItemId,
  );
  const currentIndex = status?.currentIndex ?? cafCurrentIndex;
  return {
    active: true,
    ...(currentIndex !== undefined && currentIndex >= 0
      ? { currentIndex }
      : {}),
    currentTime: duration > 0 ? Math.min(currentTime, duration) : currentTime,
    duration,
    isBuffering: status
      ? status.playerState === "BUFFERING" ||
        status.playerState === "RECOVERING"
      : playerState === "BUFFERING",
    isPlaying: status
      ? status.playerState === "PLAYING"
      : playerState === "PLAYING",
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
  let observedSession: CastSession | null = null;
  let receiverStatus: TimedCastReceiverStatus | null = null;
  let wasActive = false;

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
  const handleProtocolMessage = (_namespace: string, payload: string) => {
    let value: unknown;
    try {
      value = JSON.parse(payload);
    } catch {
      return;
    }
    const parsed = parseCastProtocolMessage(value);
    if (!parsed.ok || parsed.value.type !== "receiver.status") return;
    if (
      parsed.value.sessionId !== activeCrateCastSessionId ||
      (receiverStatus &&
        (parsed.value.stateSeq <= receiverStatus.message.stateSeq ||
          parsed.value.queueRevision < receiverStatus.message.queueRevision))
    ) {
      return;
    }
    receiverStatus = { message: parsed.value, receivedAt: Date.now() };
    publish();
  };
  const bindSession = (session: CastSession | null) => {
    if (session === observedSession) return;
    observedSession?.removeMessageListener?.(
      CAST_PROTOCOL_NAMESPACE,
      handleProtocolMessage,
    );
    observedSession = session;
    receiverStatus = null;
    observedSession?.addMessageListener?.(
      CAST_PROTOCOL_NAMESPACE,
      handleProtocolMessage,
    );
  };
  const publish = () => {
    if (disposed) return;
    clearTimer();
    const session = currentWebCastSession();
    bindSession(session);
    const media = session?.getMediaSession?.() ?? null;
    bindMedia(media);
    if (media) isCustomCastSessionActive();
    const state = currentWebCastPlaybackState(media, receiverStatus);
    if (!state) {
      if (wasActive) {
        wasActive = false;
        listener({
          active: false,
          currentTime: 0,
          duration: 0,
          isBuffering: false,
          isPlaying: false,
        });
      }
      return;
    }
    wasActive = true;
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
    bindSession(null);
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
  const receiverApplicationId =
    customReceiverApplicationId() ??
    chromeCast.media.DEFAULT_MEDIA_RECEIVER_APP_ID;
  if (webCastInitializedReceiverId !== receiverApplicationId) {
    context.setOptions({
      receiverApplicationId,
      autoJoinPolicy: chromeCast.AutoJoinPolicy.ORIGIN_SCOPED,
    });
    webCastInitializedReceiverId = receiverApplicationId;
  }
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

export function isCustomCastSessionActive(): boolean {
  if (!isCastSessionActive()) return false;
  if (activeCrateCastSessionId) return true;
  const customData = currentWebCastMedia()?.media?.customData;
  if (!customData || typeof customData !== "object") return false;
  const crateCast = (customData as Record<string, unknown>).crateCast;
  if (!crateCast || typeof crateCast !== "object") return false;
  const sessionId = (crateCast as Record<string, unknown>).sessionId;
  if (typeof sessionId !== "string" || !sessionId.trim()) return false;
  activeCrateCastSessionId = sessionId;
  const bootstrapUrl = (crateCast as Record<string, unknown>).bootstrapUrl;
  if (typeof bootstrapUrl === "string" && bootstrapUrl) {
    activeCrateCastBootstrapUrl = bootstrapUrl;
  }
  return true;
}

function queueItemRequest(
  item: CastPlaybackSessionResponse["queue"]["items"][number],
): CastSessionQueueItemRequest {
  return {
    item_id: item.item_id,
    ...(item.track_id === undefined ? {} : { track_id: item.track_id }),
    ...(item.track_entity_uid
      ? { track_entity_uid: item.track_entity_uid }
      : {}),
    ...(item.track_path ? { track_path: item.track_path } : {}),
  };
}

function rebaseQueueRequest(
  base: CastPlaybackSessionResponse["queue"]["items"],
  desired: CastSessionQueueItemRequest[],
  latest: CastPlaybackSessionResponse["queue"]["items"],
): CastSessionQueueItemRequest[] {
  const baseIds = new Set(base.map((item) => item.item_id));
  const desiredIds = new Set(desired.map((item) => item.item_id));
  const removedIds = new Set(
    [...baseIds].filter((itemId) => !desiredIds.has(itemId)),
  );
  const latestById = new Map(
    latest.map((item) => [item.item_id, queueItemRequest(item)]),
  );
  const desiredById = new Map(desired.map((item) => [item.item_id, item]));
  const replayed = desired
    .map((item) => latestById.get(item.item_id) ?? item)
    .filter((item) => !removedIds.has(item.item_id));
  const replayedIds = new Set(replayed.map((item) => item.item_id));
  for (const item of latest) {
    if (!replayedIds.has(item.item_id) && !removedIds.has(item.item_id)) {
      replayed.push(desiredById.get(item.item_id) ?? queueItemRequest(item));
    }
  }
  return replayed;
}

function customQueueItemId(item: {
  media?: { customData?: unknown };
}): string | null {
  const customData = item.media?.customData;
  if (!customData || typeof customData !== "object") return null;
  const crateCast = (customData as Record<string, unknown>).crateCast;
  if (!crateCast || typeof crateCast !== "object") return null;
  const itemId = (crateCast as Record<string, unknown>).itemId;
  return typeof itemId === "string" ? itemId : null;
}

function castCommand(
  run: (resolve: () => void, reject: (error: unknown) => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => run(resolve, reject));
}

async function applyCustomQueueDelta(
  previous: CastPlaybackSessionResponse["queue"],
  next: CastPlaybackSessionResponse["queue"],
): Promise<void> {
  const media = currentWebCastMedia();
  const chromeCast = castWindow()?.chrome?.cast;
  if (!media || !chromeCast)
    throw new Error("Custom Cast queue is unavailable.");

  const numericByStableId = new Map(
    (media.items ?? [])
      .map((item) => [customQueueItemId(item), item.itemId] as const)
      .filter(
        (entry): entry is readonly [string, number] =>
          Boolean(entry[0]) && typeof entry[1] === "number",
      ),
  );
  const previousIds = previous.items.map((item) => item.item_id);
  const nextIds = next.items.map((item) => item.item_id);
  const previousIdSet = new Set(previousIds);
  const nextIdSet = new Set(nextIds);
  const removed = previousIds.filter((itemId) => !nextIdSet.has(itemId));
  const inserted = nextIds.filter((itemId) => !previousIdSet.has(itemId));

  if (removed.length) {
    const numericIds = removed
      .map((itemId) => numericByStableId.get(itemId))
      .filter((itemId): itemId is number => itemId !== undefined);
    if (numericIds.length) {
      const request = new chromeCast.media.QueueRemoveItemsRequest(numericIds);
      await castCommand((resolve, reject) =>
        media.queueRemoveItems(request, resolve, reject),
      );
    }
  }

  if (inserted.length) {
    const syntheticSession: CastPlaybackSessionResponse = {
      session_id: activeCrateCastSessionId ?? "",
      lease: "",
      bootstrap_url: activeCrateCastBootstrapUrl ?? "",
      receiver_application_id: customReceiverApplicationId() ?? "",
      queue: next,
    };
    const built = buildWebQueueLoad(syntheticSession, chromeCast);
    const insertItem = async (position: number): Promise<void> => {
      const itemId = inserted[position];
      if (!itemId) return;
      const index = nextIds.indexOf(itemId);
      const item = built.items[index];
      if (item) {
        const request = new chromeCast.media.QueueInsertItemsRequest([item]);
        const nextExistingId = nextIds
          .slice(index + 1)
          .map((candidate) => numericByStableId.get(candidate))
          .find((candidate) => candidate !== undefined);
        if (nextExistingId !== undefined) request.insertBefore = nextExistingId;
        await castCommand((resolve, reject) =>
          media.queueInsertItems(request, resolve, reject),
        );
      }
      await insertItem(position + 1);
    };
    await insertItem(0);
  }

  const survivingDesiredOrder = nextIds
    .map((itemId) => numericByStableId.get(itemId))
    .filter((itemId): itemId is number => itemId !== undefined);
  const survivingPreviousOrder = previousIds
    .map((itemId) => numericByStableId.get(itemId))
    .filter((itemId): itemId is number => itemId !== undefined);
  if (
    !inserted.length &&
    survivingDesiredOrder.join(",") !== survivingPreviousOrder.join(",")
  ) {
    const request = new chromeCast.media.QueueReorderItemsRequest(
      survivingDesiredOrder,
    );
    await castCommand((resolve, reject) =>
      media.queueReorderItems(request, resolve, reject),
    );
  }

  if (next.repeat_mode !== previous.repeat_mode) {
    const repeatMode =
      next.repeat_mode === "all"
        ? chromeCast.media.RepeatMode.ALL
        : next.repeat_mode === "one"
          ? chromeCast.media.RepeatMode.SINGLE
          : chromeCast.media.RepeatMode.OFF;
    await castCommand((resolve, reject) =>
      media.queueSetRepeatMode(repeatMode, resolve, reject),
    );
  }
}

async function requireActiveCustomQueue() {
  if (!isCustomCastSessionActive() || !activeCrateCastSessionId) {
    throw new Error("No active Crate Cast queue.");
  }
  if (!activeCrateCastBootstrapUrl) {
    isCustomCastSessionActive();
  }
  if (!activeCrateCastBootstrapUrl) {
    throw new Error("Cast session cannot be rejoined from this sender.");
  }
  if (!activeCrateCastQueue) {
    const scoped = await loadScopedCastPlaybackSession(
      activeCrateCastBootstrapUrl,
    );
    activeCrateCastQueue = scoped.queue;
  }
  return {
    bootstrapUrl: activeCrateCastBootstrapUrl,
    queue: activeCrateCastQueue,
    sessionId: activeCrateCastSessionId,
  };
}

async function syncCustomCastQueueNow(
  update: CustomCastQueueUpdate,
): Promise<CastStartResult> {
  const { queue, repeatMode, shuffle } = update;
  try {
    const active = await requireActiveCustomQueue();
    const mutationId = crypto.randomUUID();
    let request = buildCastQueueUpdateRequest(
      queue,
      active.queue.items,
      active.queue.revision,
      mutationId,
      repeatMode,
      shuffle,
    );
    try {
      await updateCastPlaybackSession(active.sessionId, request);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      const latest = await loadScopedCastPlaybackSession(active.bootstrapUrl);
      request = {
        ...request,
        expected_revision: latest.queue.revision,
        items: rebaseQueueRequest(
          active.queue.items,
          request.items,
          latest.queue.items,
        ),
      };
      await updateCastPlaybackSession(active.sessionId, request);
    }
    const scoped = await loadScopedCastPlaybackSession(active.bootstrapUrl);
    await applyCustomQueueDelta(active.queue, scoped.queue);
    activeCrateCastQueue = scoped.queue;
    emitCastSessionChanged();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not update Cast queue.",
    };
  }
}

export function syncCustomCastQueue(
  update: CustomCastQueueUpdate,
): Promise<CastStartResult> {
  const result = castQueueWriteTail.then(() => syncCustomCastQueueNow(update));
  castQueueWriteTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function castQueueCommand(
  command: "next" | "previous" | { index: number },
): Promise<CastStartResult> {
  const media = currentWebCastMedia();
  if (!media || !isCustomCastSessionActive()) {
    return Promise.resolve({
      ok: false,
      message: "No active Crate Cast queue.",
    });
  }
  return new Promise((resolve) => {
    const success = () => resolve({ ok: true });
    const failure = (error: unknown) =>
      resolve({
        ok: false,
        message:
          error instanceof Error ? error.message : "Cast queue command failed.",
      });
    if (command === "next") {
      media.queueNext(success, failure);
      return;
    }
    if (command === "previous") {
      media.queuePrev(success, failure);
      return;
    }
    const itemId = media.items?.[command.index]?.itemId;
    if (typeof itemId !== "number") {
      resolve({ ok: false, message: "Cast queue item is unavailable." });
      return;
    }
    media.queueJumpToItem(itemId, success, failure);
  });
}

export function castQueueNext(): Promise<CastStartResult> {
  return castQueueCommand("next");
}

export function castQueuePrevious(): Promise<CastStartResult> {
  return castQueueCommand("previous");
}

export function castQueueJumpTo(index: number): Promise<CastStartResult> {
  return castQueueCommand({ index });
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

export async function disconnectCastSession(): Promise<CastStartResult> {
  if (isNative) {
    try {
      const result = await getNativeCast().endSession({ stopCasting: false });
      if (result.ok) setAuthoritativeNativeCastSession(false);
      if (result.ok) {
        activeCrateCastSessionId = null;
        activeCrateCastBootstrapUrl = null;
        activeCrateCastQueue = null;
        emitCastSessionChanged();
      }
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
    context.endCurrentSession(false);
    activeCrateCastSessionId = null;
    activeCrateCastBootstrapUrl = null;
    activeCrateCastQueue = null;
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

export async function stopCastSession(): Promise<CastStartResult> {
  const sessionId = activeCrateCastSessionId;
  const hasPlayableSession = isNative
    ? isCastSessionActive()
    : Boolean(currentWebCastMedia());
  const stopResult = hasPlayableSession
    ? await castStop()
    : ({ ok: true } satisfies CastStartResult);
  let revokeError: unknown;
  if (sessionId) {
    try {
      await revokeCastPlaybackSession(sessionId);
    } catch (error) {
      revokeError = error;
    }
  }
  if (isNative) {
    try {
      const result = await getNativeCast().endSession({ stopCasting: true });
      if (result.ok) setAuthoritativeNativeCastSession(false);
      activeCrateCastSessionId = null;
      activeCrateCastBootstrapUrl = null;
      activeCrateCastQueue = null;
      emitCastSessionChanged();
      if (!result.ok) return result;
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "Could not stop Cast.",
      };
    }
  } else {
    try {
      const context = castWindow()?.cast?.framework.CastContext.getInstance();
      context?.endCurrentSession(true);
      activeCrateCastSessionId = null;
      activeCrateCastBootstrapUrl = null;
      activeCrateCastQueue = null;
      emitCastSessionChanged();
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "Could not stop Cast.",
      };
    }
  }
  if (!stopResult.ok) return stopResult;
  if (revokeError) {
    return {
      ok: false,
      message: "Cast stopped, but its lease was not revoked.",
    };
  }
  return { ok: true };
}

export function endCastSession(): Promise<CastStartResult> {
  return stopCastSession();
}

function loadWebCastQueue(
  session: CastSession,
  response: CastPlaybackSessionResponse,
  chromeCast: ChromeCastNamespace,
): Promise<void> {
  const sessionObject = session.getSessionObj?.();
  if (!sessionObject) {
    return Promise.reject(new Error("Custom Cast queue API is unavailable."));
  }
  const load = buildWebQueueLoad(response, chromeCast);
  return new Promise((resolve, reject) => {
    sessionObject.queueLoad(
      load.items,
      load.repeatMode,
      load.startIndex,
      load.startTime,
      load.customData,
      resolve,
      reject,
    );
  });
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

    const customReceiverId = customReceiverApplicationId();
    if (!isNative && customReceiverId && webSession) {
      const castSession = await createCastPlaybackSession(payload);
      if (castSession.receiver_application_id !== customReceiverId) {
        await revokeCastPlaybackSession(castSession.session_id).catch(
          () => undefined,
        );
        return {
          ok: false,
          message: "The Cast receiver configuration does not match the server.",
        };
      }
      const chromeCast = castWindow()?.chrome?.cast;
      if (!chromeCast) {
        await revokeCastPlaybackSession(castSession.session_id).catch(
          () => undefined,
        );
        return { ok: false, message: "Google Cast sender is unavailable." };
      }
      try {
        await loadWebCastQueue(webSession, castSession, chromeCast);
      } catch (error) {
        await revokeCastPlaybackSession(castSession.session_id).catch(
          () => undefined,
        );
        throw error;
      }
      activeCrateCastSessionId = castSession.session_id;
      activeCrateCastBootstrapUrl = castSession.bootstrap_url;
      activeCrateCastQueue = castSession.queue;
      nativeCastSessionActive = false;
      emitCastSessionChanged();
      const targetName = castSessionName(webSession);
      return {
        ok: true,
        targetName,
        message: targetName ? `Casting to ${targetName}.` : "Casting started.",
      };
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
