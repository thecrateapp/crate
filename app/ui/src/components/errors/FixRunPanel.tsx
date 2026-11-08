import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";

import { OpsPanel } from "@/components/admin/ops-surfaces";
import { RelativeTime } from "@/components/admin/RelativeTime";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import { useTaskPoll } from "@/hooks/use-task-poll";
import { api } from "@/lib/api";
import {
  ERRORS_MANAGE,
  EXECUTOR_LABEL,
  FIX_STATUS_LABEL,
  apiErrorCode,
  blockerText,
  ciText,
  fixRunProblemText,
  fixRunStateText,
  fixRunUrl,
  fixStatusTone,
  isOpenFix,
  type EnqueuedTask,
  type ErrorFixRun,
  type ErrorIssueDetail,
  type FixMergeRequest,
} from "@/lib/error-inbox";

type Action = "merge" | "discard";

function RunFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-t border-border-quiet pt-2.5">
      <dt>
        <MonoLabel as="span">{label}</MonoLabel>
      </dt>
      <dd className="mt-1 font-mono text-label text-text-secondary wrap-anywhere">
        {children}
      </dd>
    </div>
  );
}

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : "—";
}

function mergeabilityText(run: ErrorFixRun): string {
  if (run.pr_mergeable === true) return "Yes";
  if (run.pr_mergeable === false) return "No, it has conflicts";
  return "Not known yet";
}

function PullRequestLink({ run }: { run: ErrorFixRun }) {
  if (!run.pr_url || !run.pr_number) return <>—</>;
  return (
    <a
      href={run.pr_url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-text-secondary underline underline-offset-4 hover:text-text-primary"
    >
      #{run.pr_number}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function mergeDescription(run: ErrorFixRun): string {
  const target = run.base_ref ?? "the base branch";
  const commit = shortSha(run.pr_head_sha);
  return run.pr_draft
    ? `Crate marks the draft ready for review so that its checks run, then merges commit ${commit} into ${target} once they pass. If anything is pushed meanwhile, or a check fails, nothing is merged.`
    : `Crate merges commit ${commit} into ${target} now. If anything was pushed since, nothing is merged.`;
}

function discardDescription(run: ErrorFixRun): string {
  if (run.pr_number)
    return `Crate closes pull request #${run.pr_number} and deletes its branch ${run.branch ?? ""} on GitHub. The issue stays as it is in Sentry.`;
  return "Crate stops the fixer's run and marks the fix discarded. The issue stays as it is in Sentry.";
}

/** Approve & merge and Discard for the open run, with their confirmations. */
function RunActions({
  issue,
  run,
  onChanged,
}: {
  issue: ErrorIssueDetail;
  run: ErrorFixRun;
  onChanged: () => void;
}) {
  const { pollTask } = useTaskPoll();
  const [dialog, setDialog] = useState<Action | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const { review } = run;
  const merging = pending === "merge";
  const discarding = pending === "discard";
  const pr = run.pr_number ? `#${run.pr_number}` : "the fix";

  /** Queues the task; a refusal throws so the dialog stays open. */
  async function send(action: Action) {
    const body: FixMergeRequest | undefined =
      action === "merge" ? { head_sha: run.pr_head_sha ?? "" } : undefined;
    const { task_id: taskId } = await api<EnqueuedTask>(
      fixRunUrl(issue.id, run.id, action),
      "POST",
      body,
    );
    setPending(action);
    pollTask(
      taskId,
      (result) => {
        setPending(null);
        if (action === "discard") toast.success(`Discarded ${pr}.`);
        else if (result?.merged) toast.success(`Merged ${pr}.`);
        else
          toast.success(
            `Approved ${pr}. Crate merges it once its checks pass.`,
          );
        onChanged();
      },
      (error) => {
        setPending(null);
        toast.error(
          error ||
            (action === "merge"
              ? "GitHub did not merge the pull request."
              : "GitHub did not discard the fix."),
        );
        onChanged();
      },
    );
  }

  function refused(caught: unknown, action: Action) {
    const code = apiErrorCode(caught);
    toast.error(fixRunProblemText(code, action));
    if (code === "ERROR_FIX_HEAD_CHANGED" || code === "ERROR_FIX_RUN_CLOSED") {
      setDialog(null);
      onChanged();
    }
  }

  const mergeVisible = run.status === "pr_open";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {run.pr_url ? (
          <Button asChild variant="outline">
            <a href={run.pr_url} target="_blank" rel="noopener noreferrer">
              Open PR
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </Button>
        ) : null}
        {mergeVisible ? (
          <Button
            type="button"
            disabled={!review.can_merge || pending !== null}
            aria-busy={merging || undefined}
            onClick={() => setDialog("merge")}
          >
            {merging ? "Approving…" : "Approve & merge"}
          </Button>
        ) : null}
        {review.can_discard ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending !== null}
            aria-busy={discarding || undefined}
            onClick={() => setDialog("discard")}
          >
            {discarding ? "Discarding…" : "Discard"}
          </Button>
        ) : null}
      </div>
      {mergeVisible && !review.can_merge && review.blockers.length > 0 ? (
        <p role="status" className="text-sm text-text-muted">
          Approve & merge is unavailable. {blockerText(review.blockers)}
        </p>
      ) : null}

      <ConfirmDialog
        open={dialog === "merge"}
        onOpenChange={(open) => setDialog(open ? "merge" : null)}
        onConfirm={() => send("merge")}
        onError={(caught) => refused(caught, "merge")}
        title={`Approve and merge ${pr}?`}
        description={mergeDescription(run)}
        body={
          <p className="text-sm text-text-secondary">
            GitHub&apos;s branch protection still applies: Crate never bypasses
            it. The merge is recorded in the audit log with your name.
          </p>
        }
        confirmLabel="Approve & merge"
        size="md"
      />
      <ConfirmDialog
        open={dialog === "discard"}
        onOpenChange={(open) => setDialog(open ? "discard" : null)}
        onConfirm={() => send("discard")}
        onError={(caught) => refused(caught, "discard")}
        title={`Discard ${pr}?`}
        description={discardDescription(run)}
        confirmLabel="Discard fix"
        tone="danger"
      />
    </div>
  );
}

function EarlierRuns({ runs }: { runs: ErrorFixRun[] }) {
  if (runs.length === 0) return null;
  return (
    <div className="space-y-2">
      <MonoLabel as="p" tone="subtle">
        Earlier attempts
      </MonoLabel>
      <ol className="list-none border-t border-border-quiet p-0">
        {runs.map((run) => (
          <li
            key={run.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border-quiet py-2.5 text-sm"
          >
            <StatusBadge tone={fixStatusTone(run.status)}>
              {FIX_STATUS_LABEL[run.status]}
            </StatusBadge>
            <span className="font-mono text-label text-text-muted">
              <RelativeTime value={run.requested_at} />
            </span>
            {run.pr_number ? <PullRequestLink run={run} /> : null}
            {run.summary ? (
              <span className="text-text-muted">{run.summary}</span>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The issue's latest fix run: its state, pull request and checks as the
 * tracker last saw them on GitHub, with Open PR, Approve & merge and Discard
 * for people with ops.errors.manage. Every GitHub call runs in a worker task.
 */
export function FixRunPanel({
  issue,
  onChanged,
}: {
  issue: ErrorIssueDetail;
  onChanged: () => void;
}) {
  const { hasCapability } = useAuth();
  const [run, ...earlier] = issue.fix_runs ?? [];
  if (!run) return null;
  const canManage = hasCapability(ERRORS_MANAGE);
  const open = isOpenFix(run.status);
  return (
    <OpsPanel
      title="Fix"
      description="The latest attempt to fix this issue and its pull request on GitHub. Crate only merges when a person approves, and only pull requests its fixer opened."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge tone={fixStatusTone(run.status)}>
            {FIX_STATUS_LABEL[run.status]}
          </StatusBadge>
          {run.pr_state === "open" && run.pr_draft ? (
            <StatusBadge>Draft</StatusBadge>
          ) : null}
          <p role="status" className="text-sm text-text-secondary">
            {fixRunStateText(run)}
          </p>
        </div>
        {run.summary ? (
          <p className="text-sm text-text-muted">{run.summary}</p>
        ) : null}

        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
          <RunFact label="Requested">
            {run.requested_by_name ?? "Someone"},{" "}
            <RelativeTime value={run.requested_at} />
          </RunFact>
          <RunFact label="Fixer">
            {run.external_run_url ? (
              <a
                href={run.external_run_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-secondary underline underline-offset-4 hover:text-text-primary"
              >
                {EXECUTOR_LABEL[run.executor]}
                <span className="sr-only"> run (opens in a new tab)</span>
              </a>
            ) : (
              EXECUTOR_LABEL[run.executor]
            )}
          </RunFact>
          <RunFact label="Pull request">
            <PullRequestLink run={run} />
          </RunFact>
          <RunFact label="Checks">{ciText(run.ci_state)}</RunFact>
          {run.pr_number ? (
            <>
              <RunFact label="Commit">{shortSha(run.pr_head_sha)}</RunFact>
              <RunFact label="Mergeable">{mergeabilityText(run)}</RunFact>
              <RunFact label="Branch">{run.branch ?? "—"}</RunFact>
            </>
          ) : null}
          <RunFact label="Checked">
            <RelativeTime value={run.checked_at} />
          </RunFact>
        </dl>

        {run.cleanup_state === "failed" ? (
          <p role="note" className="text-sm text-state-warning-text">
            Crate could not delete the branch {run.branch}: the GitHub token
            lacks Contents write. Delete it on GitHub.
          </p>
        ) : null}

        {canManage && (open || run.pr_url) ? (
          open ? (
            <RunActions issue={issue} run={run} onChanged={onChanged} />
          ) : (
            <Button asChild variant="outline">
              <a href={run.pr_url!} target="_blank" rel="noopener noreferrer">
                Open PR
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Button>
          )
        ) : null}

        <EarlierRuns runs={earlier} />
      </div>
    </OpsPanel>
  );
}
