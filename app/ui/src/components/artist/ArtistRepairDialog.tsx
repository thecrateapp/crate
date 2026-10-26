import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { SeverityMeter } from "@/components/admin/status-indicators";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "@crate/ui/icons";
import { ActionButton } from "@crate/ui/primitives/ActionGroup";
import { Checkbox } from "@crate/ui/primitives/Checkbox";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

import { Button } from "@crate/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";

import { api } from "@/lib/api";
import { useTaskEvents } from "@/hooks/use-task-events";
import { artistManagementApiPath } from "@/lib/library-routes";
import { waitForTask } from "@/lib/tasks";

interface RepairIssuePayload {
  id?: number;
  check?: string;
  check_type?: string;
  severity?: string;
  description?: string;
  details?: Record<string, unknown>;
  details_json?: Record<string, unknown>;
  auto_fixable?: boolean;
  [key: string]: unknown;
}

interface RepairPlanItem {
  issue_id?: number | null;
  item_key?: string | null;
  plan_item_id?: string | null;
  check_type: string;
  severity?: string | null;
  description?: string | null;
  support: string;
  risk?: string | null;
  scope?: string | null;
  requires_confirmation?: boolean;
  supports_batch?: boolean;
  supports_artist_scope?: boolean;
  supports_global_scope?: boolean;
  auto_fixable: boolean;
  executable: boolean;
  action?: string | null;
  target?: string | null;
  message?: string | null;
  fs_write?: boolean;
  details?: Record<string, unknown> | string | null;
  issue: RepairIssuePayload;
}

interface ArtistRepairPlanResponse {
  artist: string;
  items: RepairPlanItem[];
  total: number;
  executable: number;
  manual_only: number;
  plan_version?: string | null;
  generated_at?: string | null;
  task_id?: string | null;
  preparation_task_id?: string | null;
  status?: string;
}

interface ArtistRepairDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  artistName: string;
  artistId?: number;
  artistEntityUid?: string | null;
  onIssueCountChange?: (count: number) => void;
}

type RepairRunKind = "repair_one" | "repair_all";

interface ActiveTaskState {
  id: string;
  kind: RepairRunKind;
  itemKeys: string[];
}

interface ItemRunState {
  state: "idle" | "running" | "success" | "error";
  message?: string | null;
}

function runStateTone(runState: ItemRunState["state"]): string {
  if (runState === "success")
    return "border-accent-action/20 bg-accent-action/[0.08]";
  if (runState === "error")
    return "border-state-warning/20 bg-state-warning/[0.08]";
  if (runState === "running")
    return "border-accent-action/20 bg-accent-action/[0.06]";
  return "border-white/8 bg-panel-surface/80";
}

interface PendingRepairRun {
  items: RepairPlanItem[];
  mode: "one" | "all";
}

const CHECK_LABELS: Record<string, string> = {
  duplicate_folders: "Duplicate folders",
  canonical_mismatch: "Canonical mismatch",
  fk_orphan_albums: "Orphan albums",
  fk_orphan_tracks: "Orphan tracks",
  stale_artists: "Stale artists",
  stale_albums: "Stale albums",
  stale_tracks: "Stale tracks",
  zombie_artists: "Empty artists",
  has_photo_desync: "Photo desync",
  duplicate_albums: "Duplicate albums",
  duplicate_tracks: "Duplicate tracks",
  unindexed_files: "Unindexed files",
  tag_mismatch: "Tag mismatch",
  folder_naming: "Folder naming",
  missing_cover: "Missing cover",
  artist_layout_fix: "Artist layout fix",
};

const SCOPE_TONES: Record<string, string> = {
  db: "border-accent-action/20 bg-accent-action/[0.05] text-accent-action-hi",
  filesystem:
    "border-accent-action/20 bg-accent-action/[0.05] text-accent-action-hi",
  hybrid:
    "border-accent-action/20 bg-accent-action/[0.06] text-accent-action-hi",
};

function checkLabel(check: string) {
  return CHECK_LABELS[check] ?? check.replace(/_/g, " ");
}

function supportLabel(support: string) {
  if (support === "automatic") return "Auto";
  if (support === "manual") return "Manual";
  return "Scan only";
}

function riskLabel(risk: string | null | undefined) {
  if (risk === "safe") return "Safe";
  if (risk === "caution") return "Needs review";
  if (risk === "destructive") return "Destructive";
  return null;
}

function scopeLabel(scope: string | null | undefined) {
  if (scope === "db") return "Database";
  if (scope === "filesystem") return "Filesystem";
  if (scope === "hybrid") return "DB + filesystem";
  return null;
}

function issueDetailsSummary(details: RepairPlanItem["details"]) {
  if (!details || typeof details === "string") return details || null;
  const reason = details.reason;
  if (typeof reason === "string" && reason.trim()) return reason;
  const targetArtistDir = details.target_artist_dir;
  if (typeof targetArtistDir === "string" && targetArtistDir.trim())
    return targetArtistDir;
  const canonicalDir = details.canonical_dir;
  if (typeof canonicalDir === "string" && canonicalDir.trim())
    return canonicalDir;
  const mergedInto = details.merged_into;
  if (typeof mergedInto === "string" && mergedInto.trim())
    return `Into ${mergedInto}`;
  return null;
}

function repairItemKey(
  item: Pick<
    RepairPlanItem,
    "issue_id" | "item_key" | "check_type" | "target" | "issue"
  >,
) {
  if (item.item_key) return item.item_key;
  if (item.issue_id != null) return `issue:${item.issue_id}`;
  const details = item.issue?.details ?? item.issue?.details_json;
  const artist =
    details && typeof details === "object" && details && "artist" in details
      ? String(details.artist ?? "")
      : "";
  return `${item.check_type}:${item.target || artist || "item"}`;
}

function repairPlanItemId(
  item: Pick<
    RepairPlanItem,
    "plan_item_id" | "item_key" | "issue_id" | "check_type" | "target" | "issue"
  >,
) {
  return item.plan_item_id || repairItemKey(item);
}

export function ArtistRepairDialog({
  open,
  onOpenChange,
  artistName,
  artistId,
  artistEntityUid,
  onIssueCountChange,
}: ArtistRepairDialogProps) {
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<ArtistRepairPlanResponse | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [runningItemKey, setRunningItemKey] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<ActiveTaskState | null>(null);
  const [itemStates, setItemStates] = useState<Record<string, ItemRunState>>(
    {},
  );
  const [selectedItemKeys, setSelectedItemKeys] = useState<string[]>([]);
  const [pendingRun, setPendingRun] = useState<PendingRepairRun | null>(null);

  const endpoint = useMemo(
    () => artistManagementApiPath({ artistId, artistEntityUid }, "repair-plan"),
    [artistEntityUid, artistId],
  );
  const persistedTaskKey = useMemo(
    () => `artist-repair-task:${artistEntityUid || artistId || artistName}`,
    [artistEntityUid, artistId, artistName],
  );
  const { events, done } = useTaskEvents(activeTask?.id ?? null);

  const loadPlan = useCallback(
    async (signal?: AbortSignal) => {
      if (!endpoint) return;
      setLoading(true);
      try {
        const queued = await api<ArtistRepairPlanResponse>(
          endpoint,
          "POST",
          undefined,
          { signal },
        );
        let data = queued;
        if (queued.task_id) {
          const completionPath = `/api/manage/repair-preparations/${encodeURIComponent(
            queued.task_id,
          )}`;
          const completion = await waitForTask(
            queued.task_id,
            1800000,
            signal,
            completionPath,
          );
          if (completion.status !== "completed")
            throw new Error("Repair preparation failed");
          data = await api<ArtistRepairPlanResponse>(
            completionPath,
            "GET",
            undefined,
            { signal },
          );
        }
        if (signal?.aborted) return null;
        setPlan(data);
        const nextExecutableKeys = data.items.reduce<string[]>((keys, item) => {
          if (item.executable) keys.push(repairPlanItemId(item));
          return keys;
        }, []);
        const nextExecutableKeySet = new Set(nextExecutableKeys);
        setSelectedItemKeys((prev) => {
          const preserved = prev.filter((itemKey) =>
            nextExecutableKeySet.has(itemKey),
          );
          return preserved.length > 0 ? preserved : nextExecutableKeys;
        });
        onIssueCountChange?.(data.total);
        return data;
      } catch {
        if (signal?.aborted) return null;
        toast.error("Failed to load repair plan");
        return null;
      } finally {
        setLoading(false);
      }
    },
    [endpoint, onIssueCountChange],
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void loadPlan(controller.signal);
    return () => controller.abort();
  }, [loadPlan, open]);

  useEffect(() => {
    if (!open && !activeTask) {
      setActiveTask(null);
      setItemStates({});
      setRunningAll(false);
      setRunningItemKey(null);
      setSelectedItemKeys([]);
    }
  }, [open, activeTask]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!activeTask) {
      window.sessionStorage.removeItem(persistedTaskKey);
      return;
    }
    window.sessionStorage.setItem(persistedTaskKey, JSON.stringify(activeTask));
  }, [activeTask, persistedTaskKey]);

  useEffect(() => {
    if (!open || activeTask || typeof window === "undefined") return;
    const raw = window.sessionStorage.getItem(persistedTaskKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as ActiveTaskState;
      if (
        parsed &&
        typeof parsed.id === "string" &&
        Array.isArray(parsed.itemKeys)
      ) {
        setActiveTask(parsed);
      }
    } catch {
      window.sessionStorage.removeItem(persistedTaskKey);
    }
  }, [open, activeTask, persistedTaskKey]);

  const latestEventMessage = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const message = events[i]?.data?.message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
    return null;
  }, [events]);

  const pendingRunSummary = useMemo(() => {
    if (!pendingRun) return null;
    const risky = pendingRun.items.filter((item) => item.requires_confirmation);
    const destructive = risky.filter((item) => item.risk === "destructive");
    const filesystem = risky.filter(
      (item) => item.scope === "filesystem" || item.scope === "hybrid",
    );
    const labels = risky.map((item) => checkLabel(item.check_type));
    return {
      total: pendingRun.items.length,
      risky: risky.length,
      destructive: destructive.length,
      filesystem: filesystem.length,
      labels: Array.from(new Set(labels)).slice(0, 3),
    };
  }, [pendingRun]);

  useEffect(() => {
    if (!activeTask || events.length === 0) return;
    const lastEvent = events[events.length - 1];
    if (!lastEvent || lastEvent.type !== "item") return;

    const itemKey =
      typeof lastEvent.data?.item_key === "string"
        ? lastEvent.data.item_key
        : null;
    const outcome =
      typeof lastEvent.data?.outcome === "string"
        ? lastEvent.data.outcome
        : null;
    const message =
      typeof lastEvent.data?.message === "string"
        ? lastEvent.data.message
        : null;
    if (!itemKey || !outcome) return;

    let state: ItemRunState["state"] | null = null;
    if (outcome === "started") state = "running";
    else if (outcome === "applied" || outcome === "skipped") state = "success";
    else if (outcome === "failed" || outcome === "unsupported") state = "error";
    if (!state) return;

    setItemStates((prev) => ({
      ...prev,
      [itemKey]: { state, message },
    }));
  }, [activeTask, events]);

  useEffect(() => {
    if (!activeTask || !done) return;

    const doneStatus = String(done.status || "")
      .trim()
      .toLowerCase();
    const latestMessageLooksSuccessful = Boolean(
      latestEventMessage &&
      /repair complete:|revalidation complete:|task completed|no open issues remaining/i.test(
        latestEventMessage,
      ),
    );
    const resultIncomplete = [
      "partial",
      "failed",
      "conflict",
      "cancelled",
    ].includes(String(done.result?.status ?? ""));
    const success =
      !resultIncomplete &&
      (doneStatus === "completed" ||
        (!done.error &&
          (Boolean(done.result) || latestMessageLooksSuccessful) &&
          doneStatus !== "failed" &&
          doneStatus !== "cancelled"));
    const errorMessage = done.error || latestEventMessage || "Task failed";
    const revalidation = done.result?.revalidation as
      Record<string, unknown> | undefined;
    const remainingIssues = Number(revalidation?.issue_count ?? NaN);
    const successMessage =
      latestEventMessage ||
      (Number.isFinite(remainingIssues)
        ? remainingIssues > 0
          ? `Repair completed with ${remainingIssues} issue${
              remainingIssues === 1 ? "" : "s"
            } still open`
          : "Repair completed with no open issues remaining"
        : activeTask.kind === "repair_all"
          ? "Repair batch completed"
          : "Repair completed");
    const nextState: ItemRunState = {
      state: success ? "success" : "error",
      message: success ? successMessage : errorMessage,
    };
    setItemStates((prev) => {
      const next = { ...prev };
      for (const itemKey of activeTask.itemKeys) {
        const existing = next[itemKey];
        if (!success && existing?.state === "success") {
          continue;
        }
        next[itemKey] = nextState;
      }
      return next;
    });

    const controller = new AbortController();
    const finish = async () => {
      let nextPlan: ArtistRepairPlanResponse | null = null;
      if (success) {
        nextPlan = (await loadPlan(controller.signal)) ?? null;
      }
      if (controller.signal.aborted) return;
      if (success && nextPlan?.total === 0) {
        setItemStates({});
      }
      setRunningAll(false);
      setRunningItemKey(null);
      setActiveTask(null);
    };

    void finish();
    return () => controller.abort();
  }, [activeTask, done, latestEventMessage, loadPlan]);

  const executableItems = useMemo(
    () =>
      (plan?.items ?? []).filter(
        (item) =>
          item.executable && item.issue && item.supports_artist_scope !== false,
      ),
    [plan?.items],
  );
  const selectedItemKeySet = useMemo(
    () => new Set(selectedItemKeys),
    [selectedItemKeys],
  );
  const selectedExecutableItems = useMemo(
    () =>
      executableItems.filter((item) =>
        selectedItemKeySet.has(repairPlanItemId(item)),
      ),
    [executableItems, selectedItemKeySet],
  );

  function repairStateForItem(item: RepairPlanItem): ItemRunState {
    return itemStates[repairItemKey(item)] ?? { state: "idle", message: null };
  }

  function toggleSelected(item: RepairPlanItem) {
    const itemKey = repairPlanItemId(item);
    setSelectedItemKeys((prev) =>
      prev.includes(itemKey)
        ? prev.filter((value) => value !== itemKey)
        : [...prev, itemKey],
    );
  }

  async function executeRepair(items: RepairPlanItem[], mode: "one" | "all") {
    const issues = items.reduce<Array<NonNullable<RepairPlanItem["issue"]>>>(
      (issues, item) => {
        const issue = item.issue;
        if (issue && Object.keys(issue).length > 0) issues.push(issue);
        return issues;
      },
      [],
    );
    if (issues.length === 0) {
      toast.error("No executable fixes in this selection");
      return;
    }

    const itemKeys = items.map((item) => repairItemKey(item));
    setItemStates((prev) => {
      const next = { ...prev };
      for (const itemKey of itemKeys) {
        next[itemKey] = {
          state: "running",
          message:
            mode === "all" ? "Queued in repair batch…" : "Queued repair…",
        };
      }
      return next;
    });

    if (mode === "all") setRunningAll(true);
    else setRunningItemKey(itemKeys[0] ?? null);

    try {
      const { task_id } = await api<{ task_id: string }>(
        "/api/manage/repair-issues",
        "POST",
        {
          dry_run: false,
          preparation_task_id: plan?.preparation_task_id ?? null,
          plan_version: plan?.plan_version ?? null,
          plan_item_ids: items.map((item) => repairPlanItemId(item)),
          confirm_risky: items.some((item) => item.requires_confirmation),
        },
      );
      setActiveTask({
        id: task_id,
        kind: mode === "all" ? "repair_all" : "repair_one",
        itemKeys,
      });
      toast.success(
        mode === "all" ? `Queued ${issues.length} fixes` : "Queued repair",
      );
    } catch {
      setItemStates((prev) => {
        const next = { ...prev };
        for (const itemKey of itemKeys) {
          next[itemKey] = {
            state: "error",
            message: "Failed to queue artist repair",
          };
        }
        return next;
      });
      setRunningAll(false);
      setRunningItemKey(null);
      toast.error("Failed to queue artist repair");
    }
  }

  function runRepair(items: RepairPlanItem[], mode: "one" | "all") {
    if (items.length === 0) {
      toast.error("No executable fixes in this selection");
      return;
    }
    if (mode === "all" && items.some((item) => item.supports_batch === false)) {
      toast.error("This selection includes fixes that must be run one by one");
      return;
    }
    if (items.some((item) => item.requires_confirmation)) {
      setPendingRun({ items, mode });
      return;
    }
    void executeRepair(items, mode);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setPendingRun(null);
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="flex max-h-[88vh] flex-col overflow-hidden"
        size="2xl"
      >
        <DialogHeader>
          <DialogTitle className="font-display">
            Repair {artistName}
          </DialogTitle>
          <DialogDescription>
            Preview the fixes Crate can execute for this artist, then run them
            one by one or all at once.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center gap-2">
            <InfoBadge>{plan?.total ?? 0} issues</InfoBadge>
            <InfoBadge active>{plan?.executable ?? 0} executable</InfoBadge>
            <InfoBadge>{plan?.manual_only ?? 0} manual</InfoBadge>
            {executableItems.length ? (
              <InfoBadge>{selectedExecutableItems.length} selected</InfoBadge>
            ) : null}
            <div className="ml-auto">
              <ActionButton
                label="Refresh plan"
                onClick={() => void loadPlan()}
                disabled={loading || runningAll || runningItemKey != null}
                loading={loading}
              >
                <RefreshCw data-admin-ux="repair-refresh" aria-hidden="true" />
              </ActionButton>
            </div>
          </div>

          {executableItems.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                disabled={runningAll || runningItemKey != null}
                onClick={() =>
                  setSelectedItemKeys(
                    executableItems.map((item) => repairPlanItemId(item)),
                  )
                }
              >
                Select all auto
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                disabled={
                  !selectedItemKeys.length ||
                  runningAll ||
                  runningItemKey != null
                }
                onClick={() => setSelectedItemKeys([])}
              >
                Clear selection
              </Button>
            </div>
          ) : null}

          {activeTask ? (
            <div
              className={`rounded-md border px-4 py-3 text-sm ${
                done?.status === "failed"
                  ? "border-state-warning/20 bg-state-warning/[0.08] text-state-warning-text"
                  : done?.status === "completed"
                    ? "border-accent-action/20 bg-accent-action/[0.08] text-accent-action-hi"
                    : "border-accent-action/20 bg-accent-action/[0.06] text-accent-action-hi"
              }`}
            >
              <div className="flex items-center gap-2">
                {!done ? (
                  <Loader2
                    data-admin-ux="repair-plan-loading"
                    size={15}
                    className="animate-spin"
                  />
                ) : null}
                <span>{latestEventMessage || "Processing repair task…"}</span>
              </div>
            </div>
          ) : null}

          {loading && !plan ? (
            <div className="flex items-center justify-center py-16 text-text-muted">
              <Loader2
                data-admin-ux="repair-issues-loading"
                className="h-5 w-5 animate-spin text-primary"
              />
            </div>
          ) : plan && plan.items.length === 0 ? (
            <div className="rounded-md border border-accent-action/15 bg-accent-action/[0.06] px-4 py-5 text-sm text-accent-action-hi">
              No open repair issues for this artist.
            </div>
          ) : (
            <div className="space-y-3">
              {(plan?.items ?? []).map((item) => {
                const detailsSummary = issueDetailsSummary(item.details);
                const itemKey = repairItemKey(item);
                const planItemId = repairPlanItemId(item);
                const isRunning =
                  runningItemKey != null && runningItemKey === itemKey;
                const runState = repairStateForItem(item);
                const isSelected = selectedItemKeySet.has(planItemId);
                return (
                  <div
                    key={itemKey}
                    className={`rounded-md border p-4 ${runStateTone(
                      runState.state,
                    )}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        {item.executable ? (
                          <div className="mt-1 flex shrink-0 cursor-pointer items-center">
                            <Checkbox
                              aria-label={`Select ${checkLabel(
                                item.check_type,
                              )}`}

                              checked={isSelected}
                              disabled={runningAll || runningItemKey != null}
                              onCheckedChange={() => toggleSelected(item)}
                            />
                          </div>
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <SeverityMeter
                              level={item.severity || "low"}
                              label={item.severity || "low"}
                            />
                            <InfoBadge>{checkLabel(item.check_type)}</InfoBadge>
                            <InfoBadge active={item.executable}>
                              {supportLabel(item.support)}
                            </InfoBadge>
                            {riskLabel(item.risk) ? (
                              <SeverityMeter
                                level={item.risk}
                                label={riskLabel(item.risk) || "Unknown"}
                              />
                            ) : null}
                            {scopeLabel(item.scope) ? (
                              <InfoBadge
                                className={
                                  SCOPE_TONES[item.scope || "hybrid"] ||
                                  SCOPE_TONES.hybrid
                                }
                              >
                                {scopeLabel(item.scope)}
                              </InfoBadge>
                            ) : null}
                            {item.fs_write ? (
                              <InfoBadge active>Filesystem</InfoBadge>
                            ) : null}
                          </div>
                          <div className="mt-2 text-sm font-medium text-text-primary">
                            {item.message ||
                              item.description ||
                              checkLabel(item.check_type)}
                          </div>
                          {item.target ? (
                            <div className="mt-1 text-xs text-text-muted">
                              {item.target}
                            </div>
                          ) : null}
                          {item.requires_confirmation ? (
                            <div className="mt-2 text-xs text-state-warning-text/80">
                              Review before applying: this fix can change
                              existing library state.
                            </div>
                          ) : null}
                          {!item.supports_artist_scope ? (
                            <div className="mt-2 text-xs text-text-muted">
                              This repair is not available from the artist-level
                              flow.
                            </div>
                          ) : null}
                          {runState.message && runState.state !== "idle" ? (
                            <div
                              className={`mt-2 text-xs ${
                                runState.state === "error"
                                  ? "text-state-warning-text"
                                  : runState.state === "success"
                                    ? "text-accent-action-hi"
                                    : "text-accent-action-hi"
                              }`}
                            >
                              {runState.message}
                            </div>
                          ) : null}
                          {detailsSummary ? (
                            <div className="mt-2 text-xs text-text-muted">
                              {detailsSummary}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {item.executable ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-2"
                            disabled={
                              runningAll ||
                              runningItemKey != null ||
                              item.supports_artist_scope === false
                            }
                            onClick={() => void runRepair([item], "one")}
                          >
                            {isRunning || runState.state === "running" ? (
                              <Loader2
                                data-admin-ux="repair-scope-loading"
                                size={14}
                                className="animate-spin"
                              />
                            ) : null}
                            {runState.state === "success"
                              ? "Fixed"
                              : runState.state === "error"
                                ? "Retry fix"
                                : "Run fix"}
                          </Button>
                        ) : (
                          <div className="inline-flex items-center gap-2 rounded-md border border-border-quiet bg-surface-object px-3 py-2 text-xs text-text-muted">
                            Manual review
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter className="items-center justify-between sm:justify-between">
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <div className="text-xs text-text-muted">
                {loading && !plan
                  ? "Loading repair plan..."
                  : plan?.executable
                    ? `${plan.executable} executable fix${
                        plan.executable === 1 ? "" : "es"
                      } ready`
                    : "No executable fixes available right now"}
              </div>
              {pendingRunSummary ? (
                <div className="rounded-md border border-state-warning/20 bg-state-warning/[0.08] px-3 py-3 text-xs text-state-warning-text">
                  <MonoLabel as="div" className="text-state-warning-text">
                    Confirm risky repair
                  </MonoLabel>
                  <div className="mt-1 text-state-warning-text/85">
                    This will run {pendingRunSummary.total} selected fix
                    {pendingRunSummary.total === 1 ? "" : "es"} for {artistName}
                    . {pendingRunSummary.risky} need confirmation,{" "}
                    {pendingRunSummary.destructive} are destructive, and{" "}
                    {pendingRunSummary.filesystem} touch the filesystem.
                    {pendingRunSummary.labels.length
                      ? ` Checks: ${pendingRunSummary.labels.join(", ")}.`
                      : ""}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPendingRun(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => {
                        if (!pendingRun) return;
                        const nextRun = pendingRun;
                        setPendingRun(null);
                        void executeRepair(nextRun.items, nextRun.mode);
                      }}
                    >
                      Run confirmed repair
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="gap-2"
                disabled={
                  !executableItems.length ||
                  executableItems.some(
                    (item) => item.supports_batch === false,
                  ) ||
                  runningAll ||
                  runningItemKey != null
                }
                onClick={() => void runRepair(executableItems, "all")}
              >
                {runningAll ? (
                  <Loader2
                    data-admin-ux="repair-preview-loading"
                    size={14}
                    className="animate-spin"
                  />
                ) : null}
                Run all auto-fixable
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                disabled={
                  !selectedExecutableItems.length ||
                  (selectedExecutableItems.length > 1 &&
                    selectedExecutableItems.some(
                      (item) => item.supports_batch === false,
                    )) ||
                  runningAll ||
                  runningItemKey != null
                }
                onClick={() =>
                  void runRepair(
                    selectedExecutableItems,
                    selectedExecutableItems.length === 1 ? "one" : "all",
                  )
                }
              >
                {runningAll ? (
                  <Loader2
                    data-admin-ux="repair-queue-loading"
                    size={14}
                    className="animate-spin"
                  />
                ) : null}
                Run selected
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
