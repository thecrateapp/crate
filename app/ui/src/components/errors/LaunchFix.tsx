import { useState } from "react";
import { toast } from "sonner";

import { FormField } from "@crate/ui/primitives/FormField";
import { Button } from "@crate/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";
import { Textarea } from "@crate/ui/shadcn/textarea";

import { useTaskPoll } from "@/hooks/use-task-poll";
import { api } from "@/lib/api";
import {
  MAX_FIX_NOTE_LENGTH,
  apiErrorCode,
  clockText,
  fixProblemText,
  fixUrl,
  type EnqueuedTask,
  type ErrorIssueDetail,
  type ErrorIssueFix,
  type FixRequest,
} from "@/lib/error-inbox";

/**
 * Launch fix (E3): asks a worker to dispatch the autofix workflow for this
 * issue. The repository is public, so the confirmation says plainly that the
 * short id and the note will be visible there. The parent shows this only when
 * Launch fix is configured and the person has ops.errors.manage.
 */
export function LaunchFix({
  issue,
  fix,
  onChanged,
}: {
  issue: ErrorIssueDetail;
  fix: ErrorIssueFix;
  onChanged: () => void;
}) {
  const { pollTask } = useTaskPoll();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState(false);
  const blocked = !fix.supported || fix.available_at !== null;

  async function launch() {
    setSending(true);
    let taskId: string;
    try {
      const body: FixRequest = { note: note.trim() };
      ({ task_id: taskId } = await api<EnqueuedTask>(
        fixUrl(issue.id),
        "POST",
        body,
      ));
    } catch (caught) {
      setSending(false);
      const code = apiErrorCode(caught);
      toast.error(fixProblemText(code));
      if (code === "ERROR_FIX_RECENTLY_REQUESTED") {
        setOpen(false);
        onChanged();
      }
      return;
    }
    setSending(false);
    setOpen(false);
    setNote("");
    setPending(true);
    pollTask(
      taskId,
      () => {
        setPending(false);
        toast.success(
          `Fix launched for ${issue.short_id}. Follow the run on GitHub.`,
        );
        onChanged();
      },
      (error) => {
        setPending(false);
        toast.error(error || "GitHub did not start the workflow.");
        onChanged();
      },
    );
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={blocked || pending}
        aria-busy={pending || undefined}
        onClick={() => setOpen(true)}
      >
        {pending ? "Launching…" : "Launch fix"}
      </Button>
      <p role="status" className="text-sm text-text-muted">
        {pending
          ? "Asking GitHub to start the workflow. This can take a few seconds."
          : !fix.supported
            ? "The autofix workflow only accepts Crate short ids such as CRATE-API-1F."
            : fix.available_at
              ? `Launch fix is available again at ${clockText(fix.available_at)}.`
              : null}
      </p>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!sending) setOpen(next);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Launch a fix for {issue.short_id}?</DialogTitle>
            <DialogDescription>
              Crate asks GitHub Actions to run {fix.workflow} in{" "}
              {fix.repository}. An agent tries to reproduce the error with a
              test and, if it can, opens a draft pull request for review.
              Nothing is merged without a person.
            </DialogDescription>
          </DialogHeader>

          <p
            role="note"
            className="border-l-2 border-state-warning pl-3 text-sm text-state-warning-text"
          >
            {fix.repository} is a public repository. The short id and your note
            will be visible to anyone in the workflow run. Do not include
            personal data, file paths or secrets.
          </p>

          <FormField
            label="Note for the agent (optional)"
            hint={`${note.length} of ${MAX_FIX_NOTE_LENGTH} characters. Public.`}
          >
            <Textarea
              rows={4}
              maxLength={MAX_FIX_NOTE_LENGTH}
              disabled={sending}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormField>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={sending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={sending}
              aria-busy={sending || undefined}
              onClick={() => void launch()}
            >
              {sending ? "Launching…" : "Launch fix"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Who launched the last fix and when, with a link to the workflow runs. Shown
 * to everyone who can read the issue.
 */
export function FixRequestState({ issue }: { issue: ErrorIssueDetail }) {
  if (!issue.fix_requested_at && !issue.fix) return null;
  return (
    <p className="text-sm text-text-muted">
      {issue.fix_requested_at
        ? `Fix requested by ${issue.fix_requested_by_name ?? "someone"} at ${clockText(issue.fix_requested_at)}.`
        : "No fix has been launched for this issue."}
      {issue.fix ? (
        <>
          {" "}
          <a
            href={issue.fix.actions_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-secondary underline underline-offset-4 hover:text-text-primary"
          >
            Workflow runs on GitHub
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </>
      ) : null}
    </p>
  );
}
