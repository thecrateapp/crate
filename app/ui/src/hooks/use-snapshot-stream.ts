import { useEffect, useRef, useState } from "react";

export type SnapshotStreamStatus =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting";

/** Keeps one snapshot stream alive and retries after a bounded disconnect. */
export function useSnapshotStream<T>(
  url: string | null,
  onPayload: (payload: T) => void,
  retryMs = 5000,
): SnapshotStreamStatus {
  const onPayloadRef = useRef(onPayload);
  const [status, setStatus] = useState<SnapshotStreamStatus>(
    url ? "connecting" : "idle",
  );

  useEffect(() => {
    onPayloadRef.current = onPayload;
  }, [onPayload]);

  useEffect(() => {
    if (!url) {
      setStatus("idle");
      return;
    }

    let disposed = false;
    let hasConnected = false;
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (disposed) return;
      setStatus(hasConnected ? "reconnecting" : "connecting");
      const nextSource = new EventSource(url);
      source = nextSource;

      nextSource.onopen = () => {
        if (disposed || source !== nextSource) return;
        hasConnected = true;
        setStatus("live");
      };

      nextSource.onmessage = (event) => {
        if (disposed || source !== nextSource) return;
        try {
          onPayloadRef.current(JSON.parse(event.data) as T);
        } catch {
          // Ignore malformed frames and keep the last valid snapshot.
        }
      };

      nextSource.onerror = () => {
        if (disposed || source !== nextSource) return;
        nextSource.close();
        source = null;
        setStatus("reconnecting");
        if (reconnectTimer === null) {
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            connect();
          }, retryMs);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [retryMs, url]);

  return status;
}
