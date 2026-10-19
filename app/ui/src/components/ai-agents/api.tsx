import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useApi } from "@/hooks/use-api";
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
  toast.error(
    error instanceof Error
      ? error.message
      : "AI configuration could not be saved. Reload and review before retrying.",
  );
}
function JobStatusReader({
  job,
  onComplete,
}: {
  job: Enqueued | null;
  onComplete: () => void;
}) {
  const [finished, setFinished] = useState(false);
  const { data, error, refetch } = useApi<Job>(
    job?.task_id ? `${AI_ROOT}/jobs/${encodeURIComponent(job.task_id)}` : null,
  );
  useEffect(() => {
    setFinished(false);
  }, [job?.task_id]);
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
  if (!job) return null;
  return (
    <p role="status">
      {job.deduplicated ? "Existing job" : "Queued job"}:{" "}
      {job.task_id ?? "unavailable"} ·{" "}
      {error ??
        data?.result?.error_code ??
        data?.result?.status ??
        data?.status ??
        "pending"}
      {data?.result?.compatible != null
        ? ` · compatible: ${data.result.compatible ? "yes" : "no"}`
        : ""}
    </p>
  );
}

export function JobStatus({
  job,
  onComplete,
}: {
  job: Enqueued | null;
  onComplete: () => void;
}) {
  return job ? (
    <JobStatusReader
      key={job.task_id ?? "unknown"}
      job={job}
      onComplete={onComplete}
    />
  ) : null;
}
