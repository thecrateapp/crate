import { useId, useState } from "react";

import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { Button } from "@crate/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";

import { formatCount, isConflictError } from "@/lib/ai-models";

import { JobProgress, reportFailure, writeAI } from "./api";
import type { Enqueued, Version } from "./types";

interface Attempt {
  /** Sent with every request of this attempt so a retry is deduplicated. */
  idempotencyKey: string;
  acknowledged: boolean;
  job: Enqueued | null;
}

function newAttempt(): Attempt {
  return {
    idempotencyKey: crypto.randomUUID(),
    acknowledged: false,
    job: null,
  };
}

function noop() {}

export function BillableTestDialog({
  version,
  open,
  onOpenChange,
  refresh,
}: {
  version: Version;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Re-reads the snapshot after the profile changed under this test. */
  refresh: () => void;
}) {
  const checkboxId = useId();
  const [attempt, setAttempt] = useState(newAttempt);
  const [busy, setBusy] = useState(false);

  // Each opening is a new attempt with a new idempotency key. Retries inside
  // one opening reuse it, so a lost response cannot start a second call.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setAttempt(newAttempt());
  }

  const config = "kind" in version.config ? null : version.config;

  async function run() {
    if (!attempt.acknowledged || !config) return;
    setBusy(true);
    try {
      const job = await writeAI<Enqueued>(
        `/profiles/${encodeURIComponent(version.profile_id)}/versions/${version.version}/test`,
        {
          expected_fingerprint: version.fingerprint,
          acknowledged_billable: true,
          idempotency_key: attempt.idempotencyKey,
        },
      );
      setAttempt((current) => ({ ...current, job }));
    } catch (error) {
      reportFailure(error);
      if (isConflictError(error)) {
        // The profile changed since it was shown (AI_CONTEXT_STALE): this
        // exact version can no longer be tested. Re-read it and start over.
        refresh();
        onOpenChange(false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run a billable test?</DialogTitle>
          <DialogDescription>
            Crate sends one small synthetic request to {version.model_id}. Your
            provider may charge for it. No library data is sent, and there are
            no retries.
          </DialogDescription>
        </DialogHeader>

        {config ? (
          <p className="text-sm text-white/70">
            Up to {config.timeout_seconds} s ·{" "}
            {formatCount(config.max_input_tokens)} input and{" "}
            {formatCount(config.max_output_tokens)} output tokens reserved
          </p>
        ) : null}

        <div className="flex items-start gap-3">
          <Checkbox
            id={checkboxId}
            className="mt-0.5"
            checked={attempt.acknowledged}
            disabled={busy || attempt.job !== null}
            onCheckedChange={(checked) =>
              setAttempt((current) => ({
                ...current,
                acknowledged: checked === true,
              }))
            }
          />
          <label htmlFor={checkboxId} className="text-sm text-white/80">
            I understand this call may be billed
          </label>
        </div>

        <JobProgress job={attempt.job} kind="test" onComplete={noop} />

        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {attempt.job ? "Done" : "Cancel"}
          </Button>
          {attempt.job ? null : (
            <Button
              disabled={!attempt.acknowledged || !config || busy}
              onClick={() => void run()}
            >
              Run test
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
