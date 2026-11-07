import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@crate/ui/shadcn/button";

import { useTaskPoll } from "@/hooks/use-task-poll";
import { api } from "@/lib/api";
import {
  apiErrorCode,
  issueUrl,
  problemText,
  type EnqueuedTask,
  type ErrorIssueDetail,
  type StatusChange,
} from "@/lib/error-inbox";

type ActionId = "resolve" | "ignore" | "reopen";

const ACTIONS: Record<
  ActionId,
  { label: string; busy: string; done: string; change: StatusChange }
> = {
  resolve: {
    label: "Resolve in next release",
    busy: "Resolving…",
    done: "resolved in the next release",
    change: { status: "resolved", in_next_release: true },
  },
  ignore: {
    label: "Ignore until escalating",
    busy: "Ignoring…",
    done: "ignored until it escalates",
    change: { status: "ignored", substatus: "archived_until_escalating" },
  },
  reopen: {
    label: "Reopen",
    busy: "Reopening…",
    done: "reopened",
    change: { status: "unresolved" },
  },
};

function enqueueErrorText(error: unknown): string {
  const code = apiErrorCode(error);
  if (code === "ERROR_ISSUE_NOT_FOUND")
    return "This issue is no longer in the inbox.";
  if (code) return problemText(code);
  return "Could not send the change. Try again.";
}

/**
 * Resolve, Ignore and Reopen. Each enqueues a worker task that changes the
 * issue in Sentry first and then locally; the buttons stay disabled until the
 * task finishes. The parent decides whether they are shown at all.
 */
export function IssueStatusActions({
  issue,
  onChanged,
}: {
  issue: ErrorIssueDetail;
  onChanged: () => void;
}) {
  const { pollTask } = useTaskPoll();
  const [pending, setPending] = useState<ActionId | null>(null);
  const available: ActionId[] =
    issue.status === "unresolved" ? ["resolve", "ignore"] : ["reopen"];

  async function run(id: ActionId) {
    const action = ACTIONS[id];
    setPending(id);
    let taskId: string;
    try {
      ({ task_id: taskId } = await api<EnqueuedTask>(
        `${issueUrl(issue.id)}/status`,
        "POST",
        action.change,
      ));
    } catch (caught) {
      setPending(null);
      toast.error(enqueueErrorText(caught));
      return;
    }
    pollTask(
      taskId,
      () => {
        setPending(null);
        toast.success(`${issue.short_id} ${action.done}`);
        onChanged();
      },
      (error) => {
        setPending(null);
        toast.error(error || "Sentry did not accept the change.");
        onChanged();
      },
    );
  }

  return (
    <div className="space-y-2">
      <div
        role="group"
        aria-label="Issue status"
        className="flex flex-wrap gap-2"
      >
        {available.map((id) => (
          <Button
            key={id}
            type="button"
            variant="outline"
            disabled={pending !== null}
            aria-busy={pending === id || undefined}
            onClick={() => void run(id)}
          >
            {pending === id ? ACTIONS[id].busy : ACTIONS[id].label}
          </Button>
        ))}
      </div>
      <p role="status" className="text-sm text-text-muted">
        {pending
          ? "Sending the change to Sentry. This can take a few seconds."
          : null}
      </p>
    </div>
  );
}
