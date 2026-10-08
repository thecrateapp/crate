import {
  CAST_PROTOCOL_NAMESPACE,
  CAST_PROTOCOL_VERSION,
  parseCastProtocolMessage,
  type CastPlayerState,
  type CastProtocolMessage,
} from "@crate/cast-protocol";

import type {
  CafCustomMessageEvent,
  CafEvent,
  CafLoadRequest,
  CafPlayerManager,
  CafReceiverContext,
  CafRuntime,
  CrateLoadData,
} from "./caf-types";

export interface CafAdapterHandlers {
  onError?(event: CafEvent): void;
  onCurrentItem?(itemId: string): void;
  onLoad?(data: CrateLoadData): void;
  onPlayerState?(state: CastPlayerState): void;
  onProgress?(progress: { currentTime: number; duration: number }): void;
  onProtocolMessage?(message: CastProtocolMessage): void;
  onQueueChange?(queueData: unknown): void;
}

export interface CafAdapter {
  retryCurrentItem(): boolean;
  sendProtocolMessage(message: CastProtocolMessage, senderId?: string): void;
  skipCurrentItem(): boolean;
  start(): void;
  stop(): void;
}

interface CafAdapterOptions {
  handlers: CafAdapterHandlers;
  runtime: CafRuntime;
}

function parseLoadData(request: CafLoadRequest): CrateLoadData | null {
  const customData = request.media?.customData;
  if (!customData || typeof customData !== "object") return null;
  const candidate = (customData as Record<string, unknown>).crateCast;
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Record<string, unknown>;
  if (
    value.protocolVersion !== CAST_PROTOCOL_VERSION ||
    typeof value.sessionId !== "string" ||
    !value.sessionId.trim() ||
    typeof value.bootstrapUrl !== "string"
  ) {
    return null;
  }
  try {
    const url = new URL(value.bootstrapUrl);
    if (!new Set(["http:", "https:"]).has(url.protocol)) return null;
  } catch {
    return null;
  }
  return {
    bootstrapUrl: value.bootstrapUrl,
    protocolVersion: CAST_PROTOCOL_VERSION,
    sessionId: value.sessionId,
  };
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

export function createCafAdapter({
  runtime,
  handlers,
}: CafAdapterOptions): CafAdapter {
  let context: CafReceiverContext | null = null;
  let playerManager: CafPlayerManager | null = null;
  let started = false;
  const eventListeners = new Map<string, (event: CafEvent) => void>();

  const loadInterceptor = (request: CafLoadRequest): CafLoadRequest => {
    const data = parseLoadData(request);
    if (data) handlers.onLoad?.(data);
    return request;
  };
  const customMessageListener = (event: CafCustomMessageEvent) => {
    const parsed = parseCastProtocolMessage(event.data);
    if (parsed.ok) handlers.onProtocolMessage?.(parsed.value);
  };

  function bindEvent(type: string, listener: (event: CafEvent) => void) {
    eventListeners.set(type, listener);
    playerManager?.addEventListener(type, listener);
  }

  function publishCurrentItem() {
    const customData = playerManager?.getMediaInformation?.()?.customData;
    if (!customData || typeof customData !== "object") return;
    const crateCast = (customData as Record<string, unknown>).crateCast;
    if (!crateCast || typeof crateCast !== "object") return;
    const itemId = (crateCast as Record<string, unknown>).itemId;
    if (typeof itemId === "string" && itemId) handlers.onCurrentItem?.(itemId);
  }

  return {
    retryCurrentItem() {
      const queueManager = playerManager?.getQueueManager?.();
      if (!queueManager) return false;
      const itemId = queueManager?.getCurrentItem()?.itemId;
      if (typeof itemId !== "number") return false;
      queueManager.jumpToItem(itemId);
      return true;
    },
    start() {
      if (started) return;
      context = runtime.framework.CastReceiverContext.getInstance();
      playerManager = context.getPlayerManager();
      const eventTypes = runtime.framework.events.EventType;

      playerManager.setMessageInterceptor(
        runtime.framework.messages.MessageType.LOAD,
        loadInterceptor,
      );
      for (const [type, state] of [
        [eventTypes.MEDIA_FINISHED, "IDLE"],
        [eventTypes.PAUSE, "PAUSED"],
        [eventTypes.PLAYING, "PLAYING"],
        [eventTypes.PLAYER_LOADING, "BUFFERING"],
      ] as const) {
        bindEvent(type, () => {
          publishCurrentItem();
          handlers.onPlayerState?.(state);
        });
      }
      bindEvent(eventTypes.BUFFERING, (event) => {
        if (event.isBuffering !== false) {
          handlers.onPlayerState?.("BUFFERING");
        }
      });
      bindEvent(eventTypes.ERROR, (event) => handlers.onError?.(event));
      bindEvent(eventTypes.TIME_UPDATE, (event) => {
        handlers.onProgress?.({
          currentTime: finiteNumber(event.currentMediaTime),
          duration: finiteNumber(event.duration),
        });
      });
      bindEvent(eventTypes.MEDIA_STATUS, (event) => {
        publishCurrentItem();
        if (
          event.currentMediaTime === undefined &&
          event.duration === undefined
        ) {
          return;
        }
        handlers.onProgress?.({
          currentTime: finiteNumber(event.currentMediaTime),
          duration: finiteNumber(event.duration),
        });
      });
      for (const type of [
        eventTypes.REQUEST_QUEUE_INSERT,
        eventTypes.REQUEST_QUEUE_LOAD,
        eventTypes.REQUEST_QUEUE_REMOVE,
        eventTypes.REQUEST_QUEUE_REORDER,
        eventTypes.REQUEST_QUEUE_UPDATE,
      ]) {
        bindEvent(type, (event) => handlers.onQueueChange?.(event.queueData));
      }
      context.addCustomMessageListener(
        CAST_PROTOCOL_NAMESPACE,
        customMessageListener,
      );
      context.start();
      started = true;
    },
    sendProtocolMessage(message, senderId) {
      if (!started || !context) return;
      context.sendCustomMessage(CAST_PROTOCOL_NAMESPACE, senderId, message);
    },
    skipCurrentItem() {
      const queueManager = playerManager?.getQueueManager?.();
      const items = queueManager?.getItems() ?? [];
      const currentId = queueManager?.getCurrentItem()?.itemId;
      const currentIndex = items.findIndex((item) => item.itemId === currentId);
      const nextId = items[currentIndex + 1]?.itemId;
      if (typeof nextId !== "number") return false;
      queueManager?.jumpToItem(nextId);
      return true;
    },
    stop() {
      if (!started || !context || !playerManager) return;
      playerManager.setMessageInterceptor(
        runtime.framework.messages.MessageType.LOAD,
        null,
      );
      for (const [type, listener] of eventListeners) {
        playerManager.removeEventListener(type, listener);
      }
      eventListeners.clear();
      context.removeCustomMessageListener(
        CAST_PROTOCOL_NAMESPACE,
        customMessageListener,
      );
      context.stop?.();
      context = null;
      playerManager = null;
      started = false;
    },
  };
}
