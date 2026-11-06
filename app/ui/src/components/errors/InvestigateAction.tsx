import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@crate/ui/shadcn/button";

import { useActionLLMStatus } from "@/hooks/use-llm";
import { useTaskPoll } from "@/hooks/use-task-poll";
import { api } from "@/lib/api";
import {
  INVESTIGATE_ACTION,
  aiProblemText,
  apiErrorCode,
  currentAssessments,
  investigateUrl,
  type EnqueuedTask,
  type ErrorIssueDetail,
} from "@/lib/error-inbox";

// The task may wait for the AI lane, reads Sentry for up to 20 s and gives the
// model 90 s: follow it for longer than the default two minutes.
const INVESTIGATION_WAIT_MS = 5 * 60_000;

/**
 * Investigate (E2): queues one `ops.error.investigate` call for the issue's
 * latest event on the AI lane and follows the task. The request only queues;
 * the worker reads Sentry and calls the model. A failure stays on screen with
 * the worker's own words, so an input limit or a missing model is explained
 * where the person pressed the button. Shown to people with ops.errors.manage.
 */
export function InvestigateAction({
  issue,
  onChanged,
  onPendingChange,
}: {
  issue: ErrorIssueDetail;
  onChanged: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const model = useActionLLMStatus(INVESTIGATE_ACTION);
  const { pollTask } = useTaskPoll();
  const [pending, setPendingState] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { investigation } = currentAssessments(issue);
  const hasDigest = Boolean(issue.digest && issue.digest_hash);
  const unavailable = model !== null && !model.available;

  function setPending(value: boolean) {
    setPendingState(value);
    onPendingChange?.(value);
  }

  async function investigate() {
    setProblem(null);
    setPending(true);
    let taskId: string;
    try {
      ({ task_id: taskId } = await api<EnqueuedTask>(
        investigateUrl(issue.id),
        "POST",
      ));
    } catch (caught) {
      setPending(false);
      const text = aiProblemText(apiErrorCode(caught), "investigation");
      setProblem(text);
      toast.error(text);
      return;
    }
    pollTask(
      taskId,
      (result) => {
        setPending(false);
        if (result?.status === "skipped") {
          toast.error("This issue no longer has an event to investigate.");
        } else {
          toast.success(`Investigation of ${issue.short_id} is ready.`);
        }
        onChanged();
      },
      (error) => {
        setPending(false);
        const text = error || "The investigation failed. Try again.";
        setProblem(text);
        toast.error(text);
        onChanged();
      },
      undefined,
      INVESTIGATION_WAIT_MS,
    );
  }

  const note = pending
    ? "The model is reading the latest event. This can take a couple of minutes."
    : !hasDigest
      ? "Investigate needs the event summary; the next sync downloads it."
      : investigation
        ? "The latest event has been investigated."
        : unavailable
          ? "No usable model is bound to Investigate error issue. Bind one in AI models."
          : null;

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={
          pending ||
          !hasDigest ||
          Boolean(investigation) ||
          model?.available !== true
        }
        aria-busy={pending || undefined}
        onClick={() => void investigate()}
      >
        {pending ? "Investigating…" : "Investigate"}
      </Button>
      <p role="status" className="text-sm text-text-muted">
        {note}
      </p>
      {problem && !pending ? (
        <p role="alert" className="max-w-prose text-sm text-state-warning-text">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
