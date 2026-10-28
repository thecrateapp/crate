import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { waitForTask } from "@/lib/tasks";

const DIAGNOSIS_TIMEOUT_MS = 300000;

export function diagnosisMessage(issueCount: number): string {
  if (issueCount <= 0) return "Diagnosis found no issues";
  return `Diagnosis found ${issueCount} ${issueCount === 1 ? "issue" : "issues"}`;
}

export function useHealthDiagnosis({
  endpoint,
  reviewPath,
  onFinished,
}: {
  endpoint: string;
  reviewPath?: string;
  onFinished?: () => void;
}) {
  const navigate = useNavigate();
  const [diagnosing, setDiagnosing] = useState(false);

  const diagnose = useCallback(async () => {
    if (!endpoint) {
      toast.error("Reference missing");
      return;
    }
    setDiagnosing(true);
    try {
      const response = await api<{ task_id: string }>(endpoint, "POST");
      if (!response.task_id) {
        toast.info("A diagnosis is already running");
        return;
      }
      const task = await waitForTask(response.task_id, DIAGNOSIS_TIMEOUT_MS);
      if (task.status !== "completed") {
        toast.error("Diagnosis failed");
        return;
      }
      const issueCount = Number(task.result?.issue_count ?? 0);
      toast.success(
        diagnosisMessage(issueCount),
        issueCount > 0 && reviewPath
          ? {
              action: {
                label: "Review",
                onClick: () => navigate(reviewPath),
              },
            }
          : undefined,
      );
      onFinished?.();
    } catch {
      toast.error("Failed to run diagnosis");
    } finally {
      setDiagnosing(false);
    }
  }, [endpoint, navigate, onFinished, reviewPath]);

  return { diagnose, diagnosing };
}
