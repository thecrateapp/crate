import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { aiErrorText } from "@/lib/ai-models";

import type { Enqueued, Job } from "./types";

export const AI_ROOT = "/api/admin/ai";

export async function writeAI<T>(
  path: string,
  body: unknown,
  method: "POST" | "PATCH" = "POST",
): Promise<T> {
  return api<T>(`${AI_ROOT}${path}`, method, body);
}

export function reportFailure(error: unknown) {
  toast.error(aiErrorText(error));
}

type JobKind = "refresh" | "test";

const TERMINAL_STATUSES = ["completed", "failed", "cancelled"];

// useApi errors carry the raw response body; never render them.
const JOB_READ_ERROR =
  "Couldn't check progress. Reload the page to see the latest state.";

function progressMessage(kind: JobKind): string {
  return kind === "refresh" ? "Refreshing models…" : "Testing…";
}

function outcomeMessage(kind: JobKind, job: Job): string {
  const result = job.result;
  if (kind === "refresh") {
    return result?.status === "succeeded"
      ? `Loaded ${result.model_count ?? 0} models`
      : "Couldn't refresh models";
  }
  if (result?.compatible === true) return "Compatible";
  if (result?.compatible === false) return "Not compatible";
  return "Test failed";
}

function JobStatusReader({
  job,
  kind,
  onComplete,
}: {
  job: Enqueued;
  kind: JobKind;
  onComplete: () => void;
}) {
  const [finished, setFinished] = useState(false);
  const { data, error, refetch } = useApi<Job>(
    job.task_id ? `${AI_ROOT}/jobs/${encodeURIComponent(job.task_id)}` : null,
  );

  // The parent often passes a new inline onComplete on every render. Read it
  // from a ref so the polling effect below does not depend on it and restart
  // its timer each time, which would stall polling under frequent re-renders.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  useEffect(() => {
    setFinished(false);
  }, [job.task_id]);

  useEffect(() => {
    if (!data || finished) return;
    if (TERMINAL_STATUSES.includes(data.status)) {
      setFinished(true);
      onCompleteRef.current();
      return;
    }
    const timer = setTimeout(refetch, 1500);
    return () => clearTimeout(timer);
  }, [data, finished, refetch]);

  if (!job.task_id) {
    const message = job.deduplicated
      ? kind === "refresh"
        ? "A refresh is already running."
        : "A test is already running."
      : progressMessage(kind);
    return <p role="status">{message}</p>;
  }

  const message = error
    ? JOB_READ_ERROR
    : data && (data.result || TERMINAL_STATUSES.includes(data.status))
      ? outcomeMessage(kind, data)
      : progressMessage(kind);

  return <p role="status">{message}</p>;
}

export function JobProgress({
  job,
  kind,
  onComplete,
}: {
  job: Enqueued | null;
  kind: JobKind;
  onComplete: () => void;
}) {
  return job ? (
    <JobStatusReader
      key={job.task_id ?? "unknown"}
      job={job}
      kind={kind}
      onComplete={onComplete}
    />
  ) : null;
}
