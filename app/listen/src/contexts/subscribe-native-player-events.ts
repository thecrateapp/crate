import type {
  EngineEventListener,
  PlaybackEngine,
} from "@/lib/playback-engine";

export const NATIVE_PLAYER_EVENT_NAMES = [
  "positionChanged",
  "playEventCheckpoint",
  "stateChanged",
  "trackChanged",
  "bufferingChanged",
  "nearQueueEnd",
  "queueEnded",
  "resumeAuthorizationRequired",
  "error",
] as const;

type NativePlayerEventName = (typeof NATIVE_PLAYER_EVENT_NAMES)[number];

export type NativePlayerEventHandlers = {
  [K in NativePlayerEventName]: EngineEventListener<K>;
};

interface NativePlayerEventSubscription {
  ready: Promise<void>;
  dispose: () => void;
}

export function subscribeNativePlayerEvents(
  engine: Pick<PlaybackEngine, "on">,
  handlers: NativePlayerEventHandlers,
): NativePlayerEventSubscription {
  let disposed = false;
  const removers = new Set<() => void>();

  const register = <K extends NativePlayerEventName>(
    event: K,
    listener: EngineEventListener<K>,
  ) => engine.on(event, listener);

  const ready = (async () => {
    const results = await Promise.allSettled([
      register("positionChanged", handlers.positionChanged),
      register("playEventCheckpoint", handlers.playEventCheckpoint),
      register("stateChanged", handlers.stateChanged),
      register("trackChanged", handlers.trackChanged),
      register("bufferingChanged", handlers.bufferingChanged),
      register("nearQueueEnd", handlers.nearQueueEnd),
      register("queueEnded", handlers.queueEnded),
      register(
        "resumeAuthorizationRequired",
        handlers.resumeAuthorizationRequired,
      ),
      register("error", handlers.error),
    ]);
    const attached = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const failed = results.find((result) => result.status === "rejected");
    if (disposed || failed) {
      for (const remove of attached) remove();
      if (failed?.status === "rejected") throw failed.reason;
      return;
    }
    for (const remove of attached) removers.add(remove);
  })();

  const dispose = () => {
    disposed = true;
    for (const remove of removers) remove();
    removers.clear();
  };

  return { ready, dispose };
}
