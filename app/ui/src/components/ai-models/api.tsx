import { useEffect, useState } from "react";
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

function progressMessage(kind: JobKind): string {
  return kind === "refresh" ? "Refreshing models…" : "Testing…";
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

  useEffect(() => {
    setFinished(false);
  }, [job.task_id]);

  useEffect(() => {
    if (!data || finished) return;
    if (["completed", "failed", "cancelled"].includes(data.status)) {
      setFinished(true);
      onComplete();
      return;
    }
    const timer = setTimeout(refetch, 1500);
    return () => clearTimeout(timer);
  }, [data, finished, refetch, onComplete]);

  if (!job.task_id) {
    const message = job.deduplicated
      ? kind === "refresh"
        ? "A refresh is already running."
        : "A test is already running."
      : progressMessage(kind);
    return <p role="status">{error ?? message}</p>;
  }

  const result = data?.result;
  let message = progressMessage(kind);
  if (result) {
    if (kind === "refresh") {
      message =
        result.status === "succeeded"
          ? `Loaded ${result.model_count ?? 0} models`
          : "Couldn't refresh models";
    } else {
      message =
        result.compatible === true
          ? "Compatible"
          : result.compatible === false
            ? "Not compatible"
            : "Test failed";
    }
  }

  return <p role="status">{error ?? message}</p>;
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
