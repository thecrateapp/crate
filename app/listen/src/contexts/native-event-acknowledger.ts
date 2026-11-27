import type { NativeEventMetadata } from "@/lib/playback-engine";

export interface NativeEventAcknowledger {
  /** Records an event JS has handled (applied or deliberately dropped). */
  observe(event: Pick<NativeEventMetadata, "nativeSequence">): void;
  /** Acknowledges everything observed so far right away. */
  flush(): void;
  /** Flushes, then ignores later events. */
  dispose(): void;
}

/**
 * Native keeps play-relevant events on disk until JS acknowledges them, so a
 * process death while the WebView is frozen cannot lose plays. Acknowledging
 * per event would mean a native round trip per position checkpoint; this
 * batches them and only ever moves the acknowledged sequence forward.
 */
export function createNativeEventAcknowledger(
  acknowledge: (sequence: number) => void,
  delayMs: number,
): NativeEventAcknowledger {
  let observed = 0;
  let acknowledged = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const flush = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    if (observed <= acknowledged) return;
    acknowledged = observed;
    acknowledge(acknowledged);
  };

  return {
    observe(event) {
      if (disposed) return;
      const sequence = event?.nativeSequence;
      if (typeof sequence !== "number" || !Number.isFinite(sequence)) return;
      if (sequence <= observed) return;
      observed = sequence;
      if (timer == null) timer = setTimeout(flush, delayMs);
    },
    flush,
    dispose() {
      if (disposed) return;
      flush();
      disposed = true;
    },
  };
}
