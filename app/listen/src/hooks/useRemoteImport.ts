import { useCallback, useEffect, useState } from "react";

import { ApiError, api, apiSseUrl } from "@/lib/api";
import { cacheInvalidate } from "@/lib/cache";

export type RemoteImportStatus =
  | "idle"
  | "requesting"
  | "requested"
  | "awaiting_approval"
  | "approved"
  | "reserving"
  | "downloading"
  | "verifying"
  | "importing"
  | "completed"
  | "cancelled"
  | "failed"
  | "cleaned"
  | "offline"
  | "forbidden";

export interface RemoteImportRequest {
  request_id: string;
  status: RemoteImportStatus;
  task_id?: string | null;
  expected_bytes?: number | null;
  received_bytes?: number | null;
  failure_reason?: string | null;
}

function errorStatus(error: unknown): number | null {
  if (error instanceof ApiError) return error.status;
  if (typeof error === "object" && error && "status" in error) {
    const status = Number((error as { status?: unknown }).status);
    return Number.isFinite(status) ? status : null;
  }
  return null;
}

export function useRemoteImport(globalAlbumUid: string) {
  const [request, setRequest] = useState<RemoteImportRequest | null>(null);
  const [status, setStatus] = useState<RemoteImportStatus>("idle");

  const refresh = useCallback(async () => {
    if (!request?.request_id) return;
    try {
      const next = await api<RemoteImportRequest>(
        `/api/federation/remote/import-requests/${encodeURIComponent(
          request.request_id,
        )}`,
      );
      setRequest(next);
      setStatus(next.status);
    } catch {
      // Keep the last server-confirmed state. The next SSE signal can recover it.
    }
  }, [request?.request_id]);

  const start = useCallback(async () => {
    setStatus("requesting");
    try {
      const next = await api<RemoteImportRequest>(
        `/api/federation/remote/albums/${encodeURIComponent(
          globalAlbumUid,
        )}/import`,
        "POST",
      );
      setRequest(next);
      setStatus(next.status);
      return next;
    } catch (error) {
      const code = errorStatus(error);
      setStatus(
        code === 403 ? "forbidden" : code === 503 ? "offline" : "failed",
      );
      return null;
    }
  }, [globalAlbumUid]);

  const reset = useCallback(() => {
    setRequest(null);
    setStatus("idle");
  }, []);

  useEffect(() => {
    if (
      !request?.request_id ||
      request.task_id ||
      !["requested", "awaiting_approval", "approved"].includes(status) ||
      typeof EventSource === "undefined"
    ) {
      return;
    }
    const source = new EventSource(apiSseUrl("/api/events"));
    source.onmessage = () => void refresh();
    return () => source.close();
  }, [refresh, request?.request_id, request?.task_id, status]);

  useEffect(() => {
    const taskId = request?.task_id;
    if (!taskId || typeof EventSource === "undefined") return;
    const source = new EventSource(
      apiSseUrl(`/api/events/task/${encodeURIComponent(taskId)}`),
    );
    const onProgress = () => void refresh();
    const onDone = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          status?: string;
        };
        const terminal = payload.status as RemoteImportStatus | undefined;
        if (
          terminal &&
          ["completed", "failed", "cancelled"].includes(terminal)
        ) {
          setStatus(terminal);
          setRequest((current) =>
            current ? { ...current, status: terminal } : current,
          );
          if (terminal === "completed") {
            cacheInvalidate("library");
            cacheInvalidate(`album-global:${globalAlbumUid}`);
          }
          return;
        }
      } catch {
        // Refresh from the authoritative import request on malformed events.
      }
      void refresh();
    };
    source.addEventListener("progress", onProgress);
    source.addEventListener("task_done", onDone);
    return () => source.close();
  }, [globalAlbumUid, refresh, request?.task_id]);

  const expected = Number(request?.expected_bytes || 0);
  const received = Number(request?.received_bytes || 0);
  const progress =
    expected > 0
      ? Math.min(100, Math.round((received / expected) * 100))
      : null;

  return { request, status, progress, start, reset };
}
