import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { waitForShowJob } from "./show-import-jobs";
import { showErrorText, type ApprovalAction } from "./show-import-presentation";
import {
  isShowSaved,
  type ShowCandidate,
  type ShowConsolidation,
  type ShowOutcome,
  type ShowPlan,
} from "./show-import-types";

export type ShowPlanPhase =
  "editing" | "preparing" | "reviewed" | "applying" | "uncertain" | "saved";

export type ShowPlanRequest =
  { candidates: ShowCandidate[] } | { consolidation: ShowConsolidation };

export interface ShowPlanFlow {
  phase: ShowPlanPhase;
  plan: ShowPlan | null;
  outcomes: ShowOutcome[];
  error: string;
  changed: boolean;
  pendingKind: "prepare" | "apply" | null;
  busy: boolean;
  locked: boolean;
  prepare(request: ShowPlanRequest): void;
  apply(): void;
  retry(): void;
  invalidate(): void;
  reset(): void;
  addOutcomes(rows: ShowOutcome[]): void;
}

interface PendingRequest {
  kind: "prepare" | "apply";
  path: string;
  payload: unknown;
  jobId?: string;
}

const REQUEST_FAILED_TEXT = "The request could not be completed.";
const PREPARE_FAILED_TEXT =
  "The review didn't finish. Nothing was saved; try again.";
const APPLY_FAILED_TEXT = "The change didn't go through. Review it again.";

function freshKeys() {
  return { prepare: crypto.randomUUID(), apply: crypto.randomUUID() };
}

function mergeOutcomes(
  current: ShowOutcome[],
  rows: ShowOutcome[],
): ShowOutcome[] {
  const replaced = new Set(rows.map((row) => row.item_id));
  return [...current.filter((item) => !replaced.has(item.item_id)), ...rows];
}

/** A failed job's error, wrapped so known codes get their sentence. */
function jobFailure(execution?: { error?: string; error_code?: string }) {
  return Object.assign(new Error(execution?.error ?? ""), {
    code: execution?.error_code,
  });
}

/**
 * Review and save an exact show plan. An accepted job is resumed, never
 * re-posted: closing the panel stops waiting and leaves the request pending,
 * so a retry reuses the same body, key and job. Keys rotate only on
 * invalidate, after a definitive failure and after success.
 */
export function useShowPlan({
  open,
  approvalAction = "save",
  onApplied,
  onPartlySaved,
}: {
  open: boolean;
  /** The button an approved plan is sent with, named in approval errors. */
  approvalAction?: ApprovalAction;
  onApplied: (
    rows: ShowOutcome[],
    outcomes: ShowOutcome[],
  ) => "editing" | "saved";
  /** A save that failed or wasn't verified, but still saved these rows. */
  onPartlySaved?: (rows: ShowOutcome[]) => void;
}): ShowPlanFlow {
  const { hasCapability } = useAuth();
  const errorContext = {
    action: approvalAction,
    canApprove: hasCapability("agents.plans.review"),
  };
  const [phase, setPhase] = useState<ShowPlanPhase>("editing");
  const [plan, setPlan] = useState<ShowPlan | null>(null);
  const [outcomes, setOutcomeState] = useState<ShowOutcome[]>([]);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const [pendingKind, setPendingKind] = useState<"prepare" | "apply" | null>(
    null,
  );
  const keys = useRef(freshKeys());
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<PendingRequest | null>(null);
  // Mirrors `outcomes` so an async save merges into the latest rows.
  const outcomesRef = useRef<ShowOutcome[]>([]);

  useEffect(() => {
    if (!open) controller.current?.abort();
  }, [open]);
  useEffect(() => () => controller.current?.abort(), []);

  function setOutcomes(next: ShowOutcome[]) {
    outcomesRef.current = next;
    setOutcomeState(next);
  }

  function setPending(next: PendingRequest | null) {
    pending.current = next;
    setPendingKind(next?.kind ?? null);
  }

  /** A definitive failure: the draft unlocks with fresh keys. */
  function refuse(message: string, reviewed: ShowPlan | null) {
    setPending(null);
    keys.current = freshKeys();
    setPlan(reviewed);
    setPhase(reviewed ? "reviewed" : "editing");
    setError(message);
  }

  async function runPending() {
    const request = pending.current;
    if (!request) return;
    const reviewed = request.kind === "apply" ? plan : null;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const stoppedWaiting = () => {
      if (pending.current === request) setPhase("uncertain");
    };
    abort.signal.addEventListener("abort", stoppedWaiting, { once: true });
    setError("");
    setPhase(request.kind === "prepare" ? "preparing" : "applying");
    try {
      if (!request.jobId)
        request.jobId = (
          await api<{ job_id: string }>(request.path, "POST", request.payload, {
            signal: abort.signal,
          })
        ).job_id;
      abort.signal.throwIfAborted();
      const job = await waitForShowJob(request.jobId, abort.signal);
      abort.signal.throwIfAborted();
      if (request.kind === "prepare") {
        const prepared = job.result?.plan;
        if (job.status !== "completed" || !prepared) {
          refuse(
            showErrorText(
              jobFailure(job.result?.execution),
              PREPARE_FAILED_TEXT,
              errorContext,
            ),
            null,
          );
          return;
        }
        const complete = await api<ShowPlan>(
          `/api/show-imports/plans/${encodeURIComponent(prepared.plan_id)}`,
          "GET",
          undefined,
          { signal: abort.signal },
        );
        abort.signal.throwIfAborted();
        setPlan(complete);
        setChanged(false);
        setPending(null);
        setPhase("reviewed");
        return;
      }
      const rows = job.result?.execution?.items ?? [];
      const merged = mergeOutcomes(outcomesRef.current, rows);
      setOutcomes(merged);
      if (
        job.status !== "completed" ||
        job.result?.verification?.status !== "passed"
      ) {
        refuse(
          showErrorText(
            jobFailure(job.result?.execution),
            APPLY_FAILED_TEXT,
            errorContext,
          ),
          null,
        );
        const savedRows = rows.filter(isShowSaved);
        if (savedRows.length) onPartlySaved?.(savedRows);
        return;
      }
      setPending(null);
      keys.current = freshKeys();
      setPlan(null);
      setPhase(onApplied(rows, merged));
    } catch (failure) {
      if (abort.signal.aborted) return;
      const { status, code } = (failure ?? {}) as {
        status?: unknown;
        code?: unknown;
      };
      const message = showErrorText(failure, REQUEST_FAILED_TEXT, errorContext);
      // A stale plan can't be saved again; the editor reviews it anew.
      if (typeof status === "number" && status < 500)
        refuse(message, code === "PLAN_STALE" ? null : reviewed);
      else {
        setError(message);
        setPhase("uncertain");
      }
    } finally {
      abort.signal.removeEventListener("abort", stoppedWaiting);
      if (controller.current === abort) controller.current = null;
    }
  }

  function invalidate() {
    if (plan) setChanged(true);
    setPlan(null);
    setPhase("editing");
    setError("");
    keys.current = freshKeys();
    setPending(null);
  }

  const busy = phase === "preparing" || phase === "applying";
  const locked = busy || phase === "uncertain" || phase === "saved";

  return {
    phase,
    plan,
    outcomes,
    error,
    changed,
    pendingKind,
    busy,
    locked,
    prepare(request) {
      if (locked) return;
      setPending({
        kind: "prepare",
        path: "/api/show-imports/plans",
        payload: { ...request, idempotency_key: keys.current.prepare },
      });
      void runPending();
    },
    apply() {
      if (locked || !plan?.executable) return;
      setPending({
        kind: "apply",
        path: `/api/show-imports/plans/${encodeURIComponent(plan.plan_id)}/apply`,
        payload: {
          plan_version: plan.plan_version,
          idempotency_key: keys.current.apply,
        },
      });
      void runPending();
    },
    retry() {
      if (!busy && pending.current) void runPending();
    },
    invalidate,
    reset() {
      setPending(null);
      controller.current?.abort();
      keys.current = freshKeys();
      setPlan(null);
      setOutcomes([]);
      setError("");
      setChanged(false);
      setPhase("editing");
    },
    addOutcomes(rows) {
      if (rows.length) setOutcomes(mergeOutcomes(outcomesRef.current, rows));
    },
  };
}

/**
 * However a panel closes once its work is done (corner button, Escape, its
 * own «Close»), the next opening starts fresh. Closing with work pending
 * keeps it, so a review or save resumes.
 */
export function useResetAfterClose(
  open: boolean,
  done: boolean,
  reset: () => void,
) {
  const closed = useEffectEvent(() => {
    if (done) reset();
  });
  useEffect(() => {
    if (!open) closed();
  }, [open]);
}
