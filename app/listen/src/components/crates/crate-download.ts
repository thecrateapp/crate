import { useCallback } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { notify } from "@crate/ui/lib/notify";

import { api, apiSseUrl } from "@/lib/api";
import { downloadApiUrl } from "@/lib/library-routes";
import type { CrateSummary } from "@/pages/crates-types";

export interface CrateDownloadResponse {
  status: "ready" | "pending";
  download_url?: string | null;
  task_id?: string | null;
  filename?: string | null;
}

interface TaskDonePayload {
  status?: string;
  result?: { download_url?: string | null } | null;
  error?: string | null;
}

interface TaskSnapshot extends TaskDonePayload {
  progress?: unknown;
}

const TASK_POLL_INTERVAL_MS = 2000;
const TASK_POLL_MAX_BACKOFF_MS = 30_000;
const TASK_POLL_MAX_CONSECUTIVE_ERRORS = 5;
export const CRATE_DOWNLOAD_TIMEOUT_MS = (2 * 60 + 10) * 60 * 1000;

type CrateDownloadTarget = Pick<CrateSummary, "id" | "name">;

const activeDownloads = new Set<string>();

function downloadToastId(crateId: string) {
  return `crate-download:${crateId}`;
}

function downloadPath(crateId: string) {
  return `/api/crates/${encodeURIComponent(crateId)}/download`;
}

export function triggerCrateDownload(url: string) {
  const resolved = downloadApiUrl(url);
  if (resolved) window.location.assign(resolved);
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return value != null && Number.isFinite(number) ? number : null;
}

export function crateDownloadProgress(payload: unknown): number | null {
  if (typeof payload === "string") {
    try {
      return crateDownloadProgress(JSON.parse(payload));
    } catch {
      return null;
    }
  }
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const data =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : record;
  const percent = finiteNumber(data.percent);
  if (percent !== null) return Math.max(0, Math.min(100, Math.round(percent)));
  const total = finiteNumber(data.total);
  const done = finiteNumber(data.done ?? data.current ?? data.processed);
  if (total && total > 0 && done !== null) {
    return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  }
  return null;
}

function parseEventData(event: Event): unknown {
  try {
    return JSON.parse((event as MessageEvent<string>).data);
  } catch {
    return null;
  }
}

type CrateDownloadErrorKey =
  | "crate.download.failed"
  | "crate.download.timedOut";

function failDownload(
  crateId: string,
  t: TFunction,
  messageKey: CrateDownloadErrorKey = "crate.download.failed",
) {
  activeDownloads.delete(crateId);
  notify.error(t(messageKey), {
    id: downloadToastId(crateId),
    duration: 6000,
  });
}

function completeDownload(crateId: string, url: string, t: TFunction) {
  activeDownloads.delete(crateId);
  notify.success(t("crate.download.ready"), {
    id: downloadToastId(crateId),
    duration: 4000,
  });
  triggerCrateDownload(url);
}

async function requestCrateDownload(crateId: string) {
  return api<CrateDownloadResponse>(downloadPath(crateId), "POST");
}

function showProgress(
  crate: CrateDownloadTarget,
  progress: number | null,
  t: TFunction,
) {
  if (progress === null) return;
  notify.loading(t("crate.download.preparing", { name: crate.name }), {
    id: downloadToastId(crate.id),
    description: t("crate.download.progress", { progress }),
    duration: Infinity,
  });
}

async function finishCrateDownload(
  crate: CrateDownloadTarget,
  payload: TaskDonePayload | null,
  t: TFunction,
) {
  if (payload?.status !== "completed") {
    failDownload(crate.id, t);
    return;
  }
  try {
    const url =
      payload.result?.download_url ??
      (await requestCrateDownload(crate.id)).download_url;
    if (!url) {
      failDownload(crate.id, t);
      return;
    }
    completeDownload(crate.id, url, t);
  } catch {
    failDownload(crate.id, t);
  }
}

function pollCrateDownloadTask(
  crate: CrateDownloadTarget,
  taskId: string,
  t: TFunction,
  deadline: number,
) {
  let consecutiveErrors = 0;

  const schedule = () => {
    const delay = Math.min(
      TASK_POLL_INTERVAL_MS * 2 ** consecutiveErrors,
      TASK_POLL_MAX_BACKOFF_MS,
    );
    window.setTimeout(() => void poll(), delay);
  };

  const poll = async () => {
    if (Date.now() >= deadline) {
      failDownload(crate.id, t, "crate.download.timedOut");
      return;
    }
    let task: TaskSnapshot;
    try {
      task = await api<TaskSnapshot>(
        `/api/tasks/${encodeURIComponent(taskId)}`,
      );
    } catch {
      consecutiveErrors += 1;
      if (consecutiveErrors >= TASK_POLL_MAX_CONSECUTIVE_ERRORS) {
        failDownload(crate.id, t);
        return;
      }
      schedule();
      return;
    }
    consecutiveErrors = 0;
    if (task.status === "completed" || task.status === "failed") {
      await finishCrateDownload(crate, task, t);
      return;
    }
    if (task.status === "cancelled") {
      failDownload(crate.id, t);
      return;
    }
    showProgress(crate, crateDownloadProgress(task.progress), t);
    schedule();
  };
  void poll();
}

function watchCrateDownloadTask(
  crate: CrateDownloadTarget,
  taskId: string,
  t: TFunction,
) {
  const deadline = Date.now() + CRATE_DOWNLOAD_TIMEOUT_MS;
  if (typeof EventSource === "undefined") {
    pollCrateDownloadTask(crate, taskId, t, deadline);
    return;
  }
  const source = new EventSource(
    apiSseUrl(`/api/events/task/${encodeURIComponent(taskId)}`),
  );
  let settled = false;

  const settle = () => {
    settled = true;
    window.clearTimeout(timeout);
    source.close();
  };

  const timeout = window.setTimeout(() => {
    if (settled) return;
    settle();
    failDownload(crate.id, t, "crate.download.timedOut");
  }, CRATE_DOWNLOAD_TIMEOUT_MS);

  source.addEventListener("progress", (event) => {
    if (settled) return;
    showProgress(crate, crateDownloadProgress(parseEventData(event)), t);
  });
  source.addEventListener("task_done", (event) => {
    if (settled) return;
    settle();
    void finishCrateDownload(
      crate,
      parseEventData(event) as TaskDonePayload | null,
      t,
    );
  });
  source.onerror = () => {
    if (settled || source.readyState !== EventSource.CLOSED) return;
    settle();
    pollCrateDownloadTask(crate, taskId, t, deadline);
  };
}

export async function startCrateDownload(
  crate: CrateDownloadTarget,
  t: TFunction,
) {
  if (activeDownloads.has(crate.id)) return;
  activeDownloads.add(crate.id);
  const toastId = downloadToastId(crate.id);
  try {
    const response = await requestCrateDownload(crate.id);
    if (response.status === "ready" && response.download_url) {
      activeDownloads.delete(crate.id);
      triggerCrateDownload(response.download_url);
      return;
    }
    if (response.status !== "pending" || !response.task_id) {
      failDownload(crate.id, t);
      return;
    }
    notify.loading(t("crate.download.preparing", { name: crate.name }), {
      id: toastId,
      description: t("crate.download.queued"),
      duration: Infinity,
    });
    watchCrateDownloadTask(crate, response.task_id, t);
  } catch {
    failDownload(crate.id, t);
  }
}

export function useCrateDownload() {
  const { t } = useTranslation();
  return useCallback(
    (crate: CrateDownloadTarget) => startCrateDownload(crate, t),
    [t],
  );
}
