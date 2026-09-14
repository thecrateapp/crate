export interface CafLoadRequest {
  media?: {
    customData?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface CafEvent {
  currentMediaTime?: number;
  duration?: number;
  error?: unknown;
  isBuffering?: boolean;
  queueData?: unknown;
  [key: string]: unknown;
}

export interface CafCustomMessageEvent {
  data: unknown;
  senderId?: string;
}

export interface CafPlayerManager {
  addEventListener(type: string, listener: (event: CafEvent) => void): void;
  removeEventListener(type: string, listener: (event: CafEvent) => void): void;
  setMessageInterceptor(
    type: string,
    interceptor: ((request: CafLoadRequest) => CafLoadRequest) | null,
  ): void;
}

export interface CafReceiverContext {
  getPlayerManager(): CafPlayerManager;
  addCustomMessageListener(
    namespace: string,
    listener: (event: CafCustomMessageEvent) => void,
  ): void;
  removeCustomMessageListener(
    namespace: string,
    listener: (event: CafCustomMessageEvent) => void,
  ): void;
  start(options?: Record<string, unknown>): void;
  stop?(): void;
}

export interface CafRuntime {
  framework: {
    CastReceiverContext: {
      getInstance(): CafReceiverContext;
    };
    messages: {
      MessageType: {
        LOAD: string;
      };
    };
    events: {
      EventType: {
        BUFFERING: string;
        ERROR: string;
        MEDIA_STATUS: string;
        MEDIA_FINISHED: string;
        PAUSE: string;
        PLAYING: string;
        PLAYER_LOADING: string;
        REQUEST_QUEUE_INSERT: string;
        REQUEST_QUEUE_LOAD: string;
        REQUEST_QUEUE_REMOVE: string;
        REQUEST_QUEUE_REORDER: string;
        REQUEST_QUEUE_UPDATE: string;
        TIME_UPDATE: string;
      };
    };
  };
}

export interface CrateLoadData {
  bootstrapUrl: string;
  protocolVersion: 1;
  sessionId: string;
}
