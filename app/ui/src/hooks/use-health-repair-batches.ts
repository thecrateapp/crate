import { useEffect, useEffectEvent, useState } from "react";
import { waitForTask } from "@/lib/tasks";

type TerminalRepairStatus = "completed" | "failed" | "cancelled";
export type RepairBatchStatus =
  "waiting" | "following" | "retrying" | TerminalRepairStatus;

function isTerminalStatus(status: string): status is TerminalRepairStatus {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

export function useHealthRepairBatches(
  taskIds: string[],
  onSettled: (outcomes: TerminalRepairStatus[]) => void,
) {
  const [statuses, setStatuses] = useState<Record<string, RepairBatchStatus>>(
    {},
  );
  const settledEvent = useEffectEvent(onSettled);

  useEffect(() => {
    if (taskIds.length < 2) return;
    const controller = new AbortController();
    const { signal } = controller;

    function updateBatch(id: string, status: RepairBatchStatus) {
      if (signal.aborted) return;
      setStatuses((current) => ({ ...current, [id]: status }));
    }

    async function followBatches() {
      const outcomes: TerminalRepairStatus[] = [];
      // Backend batches run in parallel. Observe one at a time to avoid consuming
      // an HTTP/1 SSE connection per artist batch; the initial poll recovers any
      // later batch that already finished while its predecessor was observed.
      for (const id of taskIds) {
        while (!signal.aborted) {
          updateBatch(id, "following");
          try {
            const task = await waitForTask(id, 120_000, signal);
            if (signal.aborted) return;
            if (isTerminalStatus(task.status)) {
              outcomes.push(task.status);
              updateBatch(id, task.status);
              break;
            }
          } catch {
            if (signal.aborted) return;
          }
          // An unavailable observation is not a terminal task. Keep the lock and
          // retry rather than announcing completion or allowing another repair.
          updateBatch(id, "retrying");
          await new Promise<void>((resolve) => {
            const retry = window.setTimeout(() => {
              signal.removeEventListener("abort", abort);
              resolve();
            }, 5000);
            function abort() {
              window.clearTimeout(retry);
              resolve();
            }
            signal.addEventListener("abort", abort, { once: true });
          });
        }
        if (signal.aborted) return;
      }
      settledEvent(outcomes);
    }

    void followBatches();
    return () => controller.abort();
  }, [taskIds]);

  return {
    statuses,
    finishedCount: taskIds.filter((id) => isTerminalStatus(statuses[id] ?? ""))
      .length,
  };
}
