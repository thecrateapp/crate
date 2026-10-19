import { useEffect, useRef, useState } from "react";
import { Button } from "@crate/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { ShowConsolidationEditor } from "./ShowConsolidationEditor";
import { ShowSourceImport } from "./ShowSourceImport";
import { Input } from "@crate/ui/shadcn/input";
import { ShowImportReview } from "./ShowImportReview";
import {
  isShowSaved,
  emptyShow,
  showPayload,
  type ShowCandidate,
  type ShowOutcome,
  type ShowPlan,
} from "./show-import-types";
import { waitForShowJob } from "./show-import-jobs";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}
type Phase =
  "editing" | "preparing" | "reviewed" | "applying" | "uncertain" | "saved";

export function AddShowDialog({ open, onOpenChange, onSaved }: Props) {
  const { hasCapability } = useAuth();
  const [draft, setDraft] = useState(() => {
    const candidate = emptyShow();
    return { candidates: [candidate], selected: [candidate.item_id] };
  });
  const [sourceBusy, setSourceBusy] = useState(false);
  const [mode, setMode] = useState<"manual" | "assisted">("manual");
  const [coverage, setCoverage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [sharedArtist, setSharedArtist] = useState("");
  const [sharedCountry, setSharedCountry] = useState("");
  const [phase, setPhase] = useState<Phase>("editing");
  const [plan, setPlan] = useState<ShowPlan | null>(null);
  const [outcomes, setOutcomes] = useState<ShowOutcome[]>([]);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const keys = useRef({
    prepare: crypto.randomUUID(),
    apply: crypto.randomUUID(),
  });
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<{
    kind: "prepare" | "apply";
    payload: unknown;
    path: string;
    jobId?: string;
  } | null>(null);

  useEffect(() => {
    if (!open) controller.current?.abort();
  }, [open]);
  useEffect(() => () => controller.current?.abort(), []);

  function edit(candidate: ShowCandidate) {
    setDraft((current) => ({
      ...current,
      candidates: current.candidates.map((item) =>
        item.item_id === candidate.item_id ? candidate : item,
      ),
    }));
    invalidate();
  }
  function invalidate() {
    if (plan) setChanged(true);
    setPlan(null);
    setPhase("editing");
    setError("");
    keys.current = { prepare: crypto.randomUUID(), apply: crypto.randomUUID() };
    pending.current = null;
  }

  async function runPending() {
    const request = pending.current;
    if (!request) return;
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
      const accepted = request.jobId
        ? { job_id: request.jobId }
        : await api<{ job_id: string }>(request.path, "POST", request.payload, {
            signal: abort.signal,
          });
      request.jobId = accepted.job_id;
      abort.signal.throwIfAborted();
      const job = await waitForShowJob(accepted.job_id, abort.signal);
      abort.signal.throwIfAborted();
      if (request.kind === "prepare") {
        const prepared = job.result?.plan;
        if (job.status !== "completed" || !prepared) {
          pending.current = null;
          setPlan(null);
          setPhase("editing");
          keys.current = {
            prepare: crypto.randomUUID(),
            apply: crypto.randomUUID(),
          };
          setError(
            job.result?.execution?.error ??
              "Preparation failed; your draft is preserved.",
          );
          return;
        }
        const complete = await api<ShowPlan>(
          `/api/show-imports/plans/${prepared.plan_id}`,
          "GET",
          undefined,
          { signal: abort.signal },
        );
        abort.signal.throwIfAborted();
        setPlan(complete);
        setPhase("reviewed");
        setChanged(false);
        pending.current = null;
      } else {
        const rows = job.result?.execution?.items ?? [];
        setOutcomes((current) => [
          ...current.filter(
            (item) => !rows.some((row) => row.item_id === item.item_id),
          ),
          ...rows,
        ]);
        if (
          job.status !== "completed" ||
          job.result?.verification?.status !== "passed"
        ) {
          pending.current = null;
          setPlan(null);
          setPhase("editing");
          keys.current = {
            prepare: crypto.randomUUID(),
            apply: crypto.randomUUID(),
          };
          setError(
            job.result?.execution?.error ??
              "The selection could not be saved. Your draft is preserved; review again.",
          );
          return;
        }
        const savedIds = new Set(
          [...outcomes, ...rows]
            .filter(isShowSaved)
            .map((item) => item.item_id),
        );
        const remaining = draft.candidates.filter(
          (candidate) => !savedIds.has(candidate.item_id),
        ).length;
        setPhase(remaining ? "editing" : "saved");
        setPlan(null);
        setDraft((current) => ({ ...current, selected: [] }));
        keys.current = {
          prepare: crypto.randomUUID(),
          apply: crypto.randomUUID(),
        };
        pending.current = null;
        onSaved();
        toast.success(
          `${rows.length} show${rows.length === 1 ? "" : "s"} saved${remaining ? ` · ${remaining} pending` : ""}`,
        );
      }
    } catch (failure) {
      if (abort.signal.aborted) return;
      setError(
        failure instanceof Error
          ? failure.message
          : "The request could not be completed.",
      );
      const status = (failure as { status?: number })?.status;
      if (status && status < 500) {
        pending.current = null;
        setPhase(plan ? "reviewed" : "editing");
      } else setPhase("uncertain");
    } finally {
      abort.signal.removeEventListener("abort", stoppedWaiting);
      if (controller.current === abort) controller.current = null;
    }
  }

  const selectedIds = new Set(draft.selected);
  function review() {
    if (sourceBusy) return;
    const selected = draft.candidates.filter((candidate) =>
      selectedIds.has(candidate.item_id),
    );
    pending.current = {
      kind: "prepare",
      path: "/api/show-imports/plans",
      payload: {
        candidates: selected.map(showPayload),
        idempotency_key: keys.current.prepare,
      },
    };
    void runPending();
  }
  function save() {
    if (!plan?.executable || sourceBusy) return;
    pending.current = {
      kind: "apply",
      path: `/api/show-imports/plans/${plan.plan_id}/apply`,
      payload: {
        plan_version: plan.plan_version,
        idempotency_key: keys.current.apply,
      },
    };
    void runPending();
  }

  if (!hasCapability("curation.shows.write")) return null;
  const busy = phase === "preparing" || phase === "applying";
  const locked =
    busy || phase === "uncertain" || phase === "saved" || sourceBusy;
  const valid =
    draft.selected.length > 0 &&
    draft.selected.length <= 50 &&
    draft.candidates
      .filter((candidate) => selectedIds.has(candidate.item_id))
      .every(
        (candidate) =>
          candidate.artist_name?.trim() &&
          candidate.date &&
          candidate.venue?.trim() &&
          candidate.city?.trim(),
      );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add show</DialogTitle>
          <DialogDescription>
            Create and review exact shows. Manual entry works without an LLM.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            review();
          }}
        >
          <div className="flex gap-2" aria-label="Show entry mode">
            <Button
              type="button"
              variant={mode === "manual" ? "default" : "outline"}
              disabled={locked}
              onClick={() => setMode("manual")}
            >
              Manual entry
            </Button>
            <Button
              type="button"
              variant={mode === "assisted" ? "default" : "outline"}
              disabled={locked}
              onClick={() => setMode("assisted")}
            >
              Assisted import
            </Button>
          </div>
          {mode === "assisted" ? (
            <ShowSourceImport
              open={open}
              disabled={busy || phase === "uncertain" || phase === "saved"}
              onBusyChange={setSourceBusy}
              onDraft={(imported) => {
                setDraft((current) => {
                  const existingById = new Map(
                    current.candidates.map((candidate) => [
                      candidate.item_id,
                      candidate,
                    ]),
                  );
                  const rows = imported.candidates.map((candidate) => {
                    const row = {
                      ...candidate,
                      source_draft_id: imported.draft_id,
                    };
                    const existing = existingById.get(row.item_id);
                    return existing &&
                      !isShowSaved(imported.publication?.[row.item_id])
                      ? { ...row, ...existing }
                      : row;
                  });
                  const rowIds = new Set(rows.map((row) => row.item_id));
                  const blank =
                    current.candidates.length === 1 &&
                    !current.candidates[0]?.artist_name &&
                    !current.candidates[0]?.date;
                  const merged = blank
                    ? rows
                    : [
                        ...current.candidates.filter(
                          (candidate) => !rowIds.has(candidate.item_id),
                        ),
                        ...rows,
                      ];
                  return { candidates: merged, selected: [] };
                });
                if (imported.publication)
                  setOutcomes((current) => [
                    ...current.filter(
                      (item) => !imported.publication?.[item.item_id],
                    ),
                    ...Object.values(imported.publication!),
                  ]);
                setCoverage(imported.coverage);
                setWarnings(imported.warnings ?? []);
                invalidate();
              }}
            />
          ) : null}
          <ShowConsolidationEditor
            disabled={locked}
            onChange={invalidate}
            onReview={(consolidation) => {
              invalidate();
              pending.current = {
                kind: "prepare",
                path: "/api/show-imports/plans",
                payload: {
                  consolidation,
                  idempotency_key: keys.current.prepare,
                },
              };
              void runPending();
            }}
          />
          {outcomes
            .filter((item) => item.item_id === "consolidation")
            .map((item) => (
              <p key={item.item_id} role="status">
                Consolidation: {item.status}{" "}
                {item.show_id ? (
                  <a
                    className="underline"
                    href={`/shows?show_id=${item.show_id}`}
                  >
                    Open show {item.show_id}
                  </a>
                ) : null}
              </p>
            ))}
          {coverage ? (
            <p role="status" className="text-sm">
              Source coverage: {coverage}. Only selected dates are saved;
              compare the complete source before claiming a whole tour.
            </p>
          ) : null}
          {Array.from(new Set(warnings)).map((warning) => (
            <p key={warning} className="text-sm text-muted-foreground">
              {warning}
            </p>
          ))}
          {draft.candidates.length > 1 ? (
            <fieldset
              disabled={locked}
              className="space-y-2 rounded border border-border p-3"
            >
              <legend className="text-sm">Shared tour corrections</legend>
              <label className="text-sm">
                Shared artist
                <Input
                  value={sharedArtist}
                  onChange={(event) => setSharedArtist(event.target.value)}
                />
              </label>
              <label className="text-sm">
                Shared country code
                <Input
                  value={sharedCountry}
                  maxLength={2}
                  onChange={(event) => setSharedCountry(event.target.value)}
                />
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={
                  !draft.selected.length ||
                  (!sharedArtist.trim() && !sharedCountry.trim())
                }
                onClick={() => {
                  setDraft((current) => {
                    const selected = new Set(current.selected);
                    return {
                      ...current,
                      candidates: current.candidates.map((candidate) =>
                        selected.has(candidate.item_id)
                          ? {
                              ...candidate,
                              ...(sharedArtist.trim()
                                ? {
                                    artist_name: sharedArtist.trim(),
                                    artist_uid: null,
                                  }
                                : {}),
                              ...(sharedCountry.trim()
                                ? { country_code: sharedCountry.trim() }
                                : {}),
                            }
                          : candidate,
                      ),
                    };
                  });
                  invalidate();
                }}
              >
                Apply shared fields to selected dates
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const saved = new Set(
                    outcomes.filter(isShowSaved).map((item) => item.item_id),
                  );
                  setDraft((current) => ({
                    ...current,
                    selected: current.candidates
                      .filter((candidate) => !saved.has(candidate.item_id))
                      .slice(0, 50)
                      .map((candidate) => candidate.item_id),
                  }));
                  invalidate();
                }}
              >
                Select first 50 pending dates
              </Button>
            </fieldset>
          ) : null}
          <ShowImportReview
            candidates={draft.candidates}
            selected={draft.selected}
            disabled={locked}
            outcomes={outcomes}
            onChange={edit}
            onSelect={(selected) => {
              setDraft((current) => ({ ...current, selected }));
              invalidate();
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={locked || draft.candidates.length >= 200}
            onClick={() => {
              const candidate = emptyShow();
              setDraft((current) => ({
                candidates: [...current.candidates, candidate],
                selected:
                  current.selected.length < 50
                    ? [...current.selected, candidate.item_id]
                    : current.selected,
              }));
              invalidate();
            }}
          >
            Add another date to draft
          </Button>
          {draft.selected.length > 50 ? (
            <p role="alert">
              Choose at most 50 dates per plan; every remaining row stays
              pending.
            </p>
          ) : null}
          {changed ? (
            <p role="status" className="text-sm">
              The draft changed. Review again before saving.
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {busy ? (
            <p role="status" className="text-sm">
              {phase === "preparing"
                ? "Preparing the exact selection…"
                : "Saving the reviewed selection…"}
            </p>
          ) : null}
          {plan ? (
            <section className="space-y-2 rounded-md border border-border p-3">
              <h3 className="font-medium">Review exact selection</h3>
              {plan.changes.map((change) => (
                <div key={change.item_id} className="text-sm">
                  <h4>
                    {change.after.artist_name} · {change.after.date}
                  </h4>
                  <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3">
                    {Object.entries(change.after)
                      .filter(([key]) => key !== "item_id")
                      .map(([key, value]) => (
                        <div key={key} className="contents">
                          <dt className="text-muted-foreground">
                            {key.replace(/_/g, " ")}
                          </dt>
                          <dd className="break-all">
                            {value == null
                              ? "Unknown"
                              : Array.isArray(value)
                                ? value.join(", ")
                                : typeof value === "object"
                                  ? JSON.stringify(value)
                                  : String(value)}
                          </dd>
                        </div>
                      ))}
                  </dl>
                  {Object.keys(change.before).length > 0 ? (
                    <details>
                      <summary>Current saved values</summary>
                      <pre className="whitespace-pre-wrap break-all">
                        {JSON.stringify(change.before, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </div>
              ))}
              {plan.issues?.map((issue, index) => (
                <p
                  role="alert"
                  key={index}
                  className="text-sm text-destructive"
                >
                  {issue.item_id
                    ? `Show ${draft.candidates.findIndex((item) => item.item_id === issue.item_id) + 1}: `
                    : ""}
                  {issue.reason ??
                    `Required: ${(issue.missing ?? []).join(", ")}`}
                </p>
              ))}
              {plan.issues
                ?.filter((issue) => issue.matches?.length)
                .map((issue) => (
                  <div key={issue.item_id} className="flex gap-2">
                    {issue.matches?.map((id) => (
                      <Button
                        type="button"
                        variant="outline"
                        key={id}
                        onClick={async () => {
                          try {
                            const existing = await api<{
                              id: number;
                              revision: number;
                            }>(`/api/show-imports/shows/${id}`);
                            const candidate = draft.candidates.find(
                              (item) => item.item_id === issue.item_id,
                            );
                            if (candidate)
                              edit({
                                ...candidate,
                                existing_show_id: existing.id,
                                expected_revision: existing.revision,
                              });
                          } catch {
                            setError(
                              "The existing show could not be loaded. Keep this draft and retry.",
                            );
                          }
                        }}
                      >
                        Use existing show {id}
                      </Button>
                    ))}
                  </div>
                ))}
              {plan.issues
                ?.filter((issue) => issue.artist_matches?.length)
                .map((issue) => (
                  <div key={issue.item_id} className="flex flex-wrap gap-2">
                    {issue.artist_matches?.map((artist) => (
                      <Button
                        type="button"
                        variant="outline"
                        key={artist.artist_uid}
                        onClick={() => {
                          const candidate = draft.candidates.find(
                            (row) => row.item_id === issue.item_id,
                          );
                          if (candidate)
                            edit({
                              ...candidate,
                              artist_uid: artist.artist_uid,
                              artist_name: artist.name,
                            });
                        }}
                      >
                        Use artist {artist.name} ·{" "}
                        {artist.artist_uid.slice(0, 8)}
                      </Button>
                    ))}
                  </div>
                ))}
              {plan.approval_required ? (
                <p className="text-sm">
                  This exact plan requires human approval.{" "}
                  <a
                    className="underline"
                    href={`/agents/approvals/${plan.plan_id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open Agent approvals
                  </a>{" "}
                  before applying.
                </p>
              ) : null}
            </section>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            {phase === "uncertain" ? (
              <Button type="button" onClick={() => void runPending()}>
                {pending.current?.kind === "apply"
                  ? "Retry same save"
                  : "Retry same review"}
              </Button>
            ) : null}
            {phase === "editing" || phase === "reviewed" ? (
              <Button type="submit" disabled={!valid || locked}>
                Review selection
              </Button>
            ) : null}
            {phase === "reviewed" && plan?.executable ? (
              <Button type="button" onClick={save} disabled={locked}>
                Save selected shows
              </Button>
            ) : null}
            {phase === "saved" ? (
              <Button
                type="button"
                onClick={() => {
                  const candidate = emptyShow();
                  setDraft({
                    candidates: [candidate],
                    selected: [candidate.item_id],
                  });
                  setOutcomes([]);
                  invalidate();
                }}
              >
                Add another show
              </Button>
            ) : null}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
