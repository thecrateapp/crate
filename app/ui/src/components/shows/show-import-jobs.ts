import { api } from "@/lib/api";
import type { ShowJob } from "./show-import-types";

export async function waitForShowJob(
  id: string,
  signal: AbortSignal,
): Promise<ShowJob> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const job = await api<ShowJob>(
      `/api/show-imports/jobs/${encodeURIComponent(id)}`,
      "GET",
      undefined,
      { signal },
    );
    if (["completed", "failed", "cancelled"].includes(job.status)) return job;
    await new Promise<void>((resolve, reject) => {
      const stop = () => {
        clearTimeout(timer);
        reject(new DOMException("Stopped waiting", "AbortError"));
      };
      const timer = setTimeout(
        () => {
          signal.removeEventListener("abort", stop);
          resolve();
        },
        Math.min(1000 + attempt * 250, 2500),
      );
      signal.addEventListener("abort", stop, { once: true });
      if (signal.aborted) stop();
    });
  }
  throw new Error(
    "The job is still pending. Keep this draft and check its status again.",
  );
}
