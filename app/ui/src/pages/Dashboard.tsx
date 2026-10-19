import {
  PageHeaderAction,
  PageHeaderActions,
  PageHeaderLayout,
} from "@/components/layout/PageHeader";
import {
  RefreshCw as HeaderRefreshCw,
  Wrench as HeaderWrench,
  Loader2,
} from "lucide-react";
import { useEffect, useReducer, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { getDashboardModel } from "@/components/admin/dashboard-model";
import { useAuth } from "@/contexts/AuthContext";
import { useOpsSnapshot } from "@/contexts/OpsSnapshotContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { InstrumentPanel } from "@crate/ui/primitives/InstrumentPanel";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { ProgressHairline } from "@crate/ui/primitives/ProgressHairline";
import { AppModal, ModalBody } from "@crate/ui/primitives/AppModal";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { Button } from "@crate/ui/shadcn/button";

function ReportTime({ value }: { value: string | null }) {
  return value ? (
    <time dateTime={value}>{new Date(value).toLocaleString()}</time>
  ) : (
    <span>Time unavailable</span>
  );
}
export function Dashboard() {
  const {
    data: opsSnapshot,
    loading: loadingSnapshot,
    error: snapshotError,
    refresh,
  } = useOpsSnapshot();
  const { isAdmin, hasCapability } = useAuth();
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [showRebuildConfirm, setShowRebuildConfirm] = useState(false);
  const [, expireReport] = useReducer((version: number) => version + 1, 0);
  const expiry = opsSnapshot?.snapshot?.stale_after;
  // Expire the displayed report at the producer's deadline, without polling or another stream.
  useEffect(() => {
    const deadline = expiry ? Date.parse(expiry) : NaN;
    if (!Number.isFinite(deadline) || deadline <= Date.now()) return;
    let timer: ReturnType<typeof setTimeout>;
    function schedule() {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        expireReport();
        return;
      }
      timer = setTimeout(schedule, Math.min(remaining + 1, 2147483647));
    }
    schedule();
    return () => clearTimeout(timer);
  }, [expiry]);
  if (!opsSnapshot)
    return loadingSnapshot ? (
      <LoadingState label="Loading dashboard" />
    ) : (
      <ErrorState
        message={
          snapshotError
            ? "Failed to load dashboard"
            : "No dashboard report available"
        }
        onRetry={() => void refresh(true)}
      />
    );
  const model = getDashboardModel(opsSnapshot, snapshotError, Date.now());
  const canTasks = hasCapability("ops.tasks.manage"),
    canSystem = hasCapability("ops.health.view"),
    canStack = hasCapability("ops.runtime.manage"),
    canAnalysis = hasCapability("library.analysis.manage");
  const canSync = hasCapability("library.import.manage"),
    canMaintain = isAdmin && hasCapability("library.maintenance.manage");
  async function triggerLibrarySync() {
    try {
      await api("/api/tasks/sync-library", "POST");
      toast.success("Library sync started");
      void refresh(true);
    } catch {
      toast.error("Sync already running or failed");
    }
  }
  const attentionBlock = (
    <InstrumentPanel
      as="section"
      headingLevel={2}
      summary="Needs attention"
      label={{ accent: "03", children: "Needs attention" }}
    >
      {model.attention.length ? (
        <ul className="divide-y divide-border-quiet border-y border-border-quiet">
          {model.attention.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="m-0 flex items-baseline gap-2 text-sm font-medium">
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-state-warning"
                  />
                  {item.label} reported offline
                </p>
                <p className="mt-1 text-sm text-text-muted">{item.detail}</p>
              </div>
              {canSystem ? (
                <Button
                  asChild
                  variant="ghost"
                  className="min-h-11 shrink-0 self-start"
                >
                  <Link to="/system">Inspect system</Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm text-text-muted">
          {model.freshness !== "current"
            ? "Current interruptions cannot be assessed from this report."
            : model.signals.some((signal) => signal.state === "unknown")
              ? "No offline status in the available signals. Unreported services are not assessed."
              : "No service interruption reported."}
        </p>
      )}
    </InstrumentPanel>
  );
  return (
    <div className="grid min-w-0 gap-8 pb-6">
      <PageHeaderLayout
        as="header"
        actions={
          <PageHeaderActions>
            <PageHeaderAction
              label="Refresh"
              onClick={() => void refresh(true)}
            >
              <HeaderRefreshCw
                data-admin-ux="header-refresh"
                aria-hidden="true"
              />
            </PageHeaderAction>
            {canSync || canMaintain ? (
              <PageHeaderAction
                label="Maintenance"
                onClick={() => setMaintenanceOpen(true)}
              >
                <HeaderWrench
                  data-admin-ux="header-maintenance"
                  aria-hidden="true"
                />
              </PageHeaderAction>
            ) : null}
          </PageHeaderActions>
        }
      >
        <div>
          <h1 className="m-0 font-display text-[clamp(2.25rem,4vw,3.75rem)] font-extrabold leading-display tracking-[-0.045em] text-balance">
            Dashboard
          </h1>
          <p className="mt-3 text-sm text-text-muted">
            Service signals, reported work and interruptions.
          </p>
        </div>
      </PageHeaderLayout>
      <InstrumentPanel
        as="section"
        headingLevel={2}
        summary="System"
        label={{ accent: "01", children: "System" }}
        meta={
          model.freshness === "current"
            ? "Current report"
            : model.freshness === "stale"
              ? "Outdated report"
              : "Freshness unknown"
        }
      >
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={cn(
            "m-0 font-display text-3xl font-bold leading-tight tracking-tight",
            model.attention.length > 0
              ? "text-state-warning-text"
              : "text-text-primary",
          )}
        >
          {model.headline}
        </p>
        <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
          {model.signals.map((signal) => (
            <div
              key={signal.id}
              className="flex flex-wrap items-baseline gap-2"
            >
              <dt className="font-mono text-label font-normal uppercase tracking-caps text-text-subtle">
                {signal.label}
              </dt>
              <dd
                className={cn(
                  "m-0 font-mono text-label font-normal tabular-nums",
                  model.freshness !== "current" || signal.state === "unknown"
                    ? "text-text-muted"
                    : signal.state === "offline"
                      ? "text-state-warning-text"
                      : "text-accent-action-hi",
                )}
              >
                {signal.state === "unknown"
                  ? "Unreported"
                  : `${model.freshness !== "current" ? "Last reported " : ""}${signal.state}`}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <div className="crate-form-field">
            <MonoLabel as="div">Last report</MonoLabel>
            <div className="font-mono text-label font-normal tabular-nums text-text-muted">
              <ReportTime value={model.builtAt} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canSystem ? (
              <Button asChild variant="ghost" className="min-h-11">
                <Link to="/system">System details</Link>
              </Button>
            ) : null}
            {canStack ? (
              <Button asChild variant="ghost" className="min-h-11">
                <Link to="/stack">Services</Link>
              </Button>
            ) : null}
          </div>
        </div>
        <p className="mt-4 text-sm text-text-muted">
          Worker availability is not reported here.
        </p>
      </InstrumentPanel>
      {model.attention.length > 0 ? attentionBlock : null}
      <InstrumentPanel
        as="section"
        headingLevel={2}
        summary="Work in progress"
        label={{ accent: "02", children: "Work in progress" }}
        meta={`${model.freshness !== "current" ? "Last report · " : ""}${model.running ?? "—"} running · ${model.waiting ?? "—"} waiting`}
      >
        {model.running === null || model.waiting === null ? (
          <p className="mb-4 text-sm text-text-muted">
            Task queue totals unavailable.
          </p>
        ) : null}
        {model.work.length > 0 ? (
          <ul className="divide-y divide-border-quiet border-y border-border-quiet">
            {model.work.slice(0, 5).map((task) => (
              <li key={task.id} className="grid min-w-0 gap-3 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {task.status === "running" ? (
                      <Loader2
                        size={14}
                        aria-hidden="true"
                        data-admin-ux="dashboard-running-task"
                        className="shrink-0 animate-spin text-accent-action-hi"
                      />
                    ) : null}
                    {canTasks ? (
                      <Link
                        to={`/tasks?task=${encodeURIComponent(task.id)}`}
                        className="inline-flex min-h-11 min-w-0 items-center break-words text-sm font-medium underline decoration-border-quiet underline-offset-4 hover:decoration-accent-action-hi"
                      >
                        {task.label}
                      </Link>
                    ) : (
                      <span className="min-w-0 break-words text-sm font-medium">
                        {task.label}
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-label font-normal text-text-muted">
                    {task.status}
                  </span>
                </div>
                <p className="m-0 break-words text-sm text-text-muted">
                  {task.detail}
                </p>
                {task.percent !== null ? (
                  <div className="crate-form-field">
                    <MonoLabel as="div">
                      Reported progress · {task.quantity ?? `${task.percent}%`}
                    </MonoLabel>
                    <ProgressHairline
                      label={`Reported progress: ${task.label}`}
                      value={task.percent / 100}
                      valueText={
                        task.quantity
                          ? `${task.quantity} (${task.percent}%)`
                          : `${task.percent}%`
                      }
                    />
                  </div>
                ) : null}
                <div className="font-mono text-label font-normal tabular-nums text-text-subtle">
                  Updated <ReportTime value={task.updatedAt} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-sm text-text-muted">No task rows reported.</p>
        )}
        {model.work.length > 5 ? (
          <p className="mt-3 text-sm text-text-muted">
            Showing 5 of {model.work.length} reported tasks.
          </p>
        ) : null}
        {model.analysisReported && model.analysisFreshness !== "current" ? (
          <p className="mt-4 text-sm text-text-muted">
            {model.analysisFreshness === "stale"
              ? "Background analysis report out of date."
              : "Background analysis report freshness unknown."}
          </p>
        ) : null}
        {model.daemons.length > 0 ? (
          <ul
            aria-label="Background analysis activity"
            className="mt-4 grid gap-2"
          >
            {model.daemons.map((item) => (
              <li
                key={item.label}
                className="flex flex-wrap justify-between gap-2 text-sm"
              >
                <span>{item.label}</span>
                <span className="font-mono text-label font-normal tabular-nums text-text-muted">
                  {item.active}{" "}
                  {model.analysisFreshness === "current"
                    ? "reported active"
                    : "last reported active"}
                </span>
              </li>
            ))}
          </ul>
        ) : !model.analysisReported ? (
          <p className="mt-4 text-sm text-text-muted">
            Background analysis activity unavailable.
          </p>
        ) : null}
        <div className="mt-5 grid gap-3 border-t border-border-quiet pt-4">
          {[
            { label: "Last completed", task: model.lastCompleted },
            { label: "Last recorded failure", task: model.lastFailed },
          ].map(({ label, task }) =>
            task ? (
              <div
                key={label}
                className="flex flex-wrap items-baseline justify-between gap-2 text-sm"
              >
                <span className="text-text-muted">
                  {label} · {task.label}
                </span>
                <span className="font-mono text-label font-normal tabular-nums text-text-subtle">
                  <ReportTime value={task.updatedAt} />
                </span>
              </div>
            ) : null,
          )}
          <div className="flex flex-wrap gap-2">
            {canTasks ? (
              <Button asChild variant="ghost" className="min-h-11">
                <Link to="/tasks">All tasks</Link>
              </Button>
            ) : null}
            {canAnalysis ? (
              <Button asChild variant="ghost" className="min-h-11">
                <Link to="/analysis">Analysis details</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </InstrumentPanel>
      {model.attention.length === 0 ? attentionBlock : null}
      <AppModal
        open={maintenanceOpen && (canSync || canMaintain)}
        onClose={() => setMaintenanceOpen(false)}
        title="Library maintenance"
        eyebrow="Maintenance"
        description="Library operations. Rebuild and wipe require typed confirmation."
        closeLabel="Close maintenance"
        closeOnEscape={!showWipeConfirm && !showRebuildConfirm}
        closeOnOverlay={!showWipeConfirm && !showRebuildConfirm}
        closeDisabled={showWipeConfirm || showRebuildConfirm}
        size="sm"
      >
        <ModalBody className="grid gap-6 px-6 py-5">
          {canSync ? (
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => void triggerLibrarySync()}
            >
              Sync library
            </Button>
          ) : null}
          {canMaintain ? (
            <div className="grid gap-3 border-t border-border-quiet pt-5">
              <MonoLabel>Database maintenance</MonoLabel>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => setShowRebuildConfirm(true)}
              >
                Rebuild library
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => setShowWipeConfirm(true)}
              >
                Wipe database
              </Button>
            </div>
          ) : null}
        </ModalBody>
      </AppModal>
      <ConfirmDialog
        open={showRebuildConfirm}
        onOpenChange={setShowRebuildConfirm}
        title="Rebuild Library"
        description="This will wipe the entire library database and rebuild from scratch. This includes: wipe DB, health check, repair, full sync, and re-enrichment. This may take a while."
        confirmLabel="Rebuild Library"
        variant="destructive"
        onConfirm={() => {
          void (async () => {
            try {
              await api("/api/manage/rebuild", "POST");
              toast.success("Library rebuild started");
              void refresh(true);
            } catch {
              toast.error("Failed to start rebuild");
            }
          })();
        }}
        eyebrow="Confirm action"
        consequence="Resets library database · health check · repair · full sync · re-enrichment"
        confirmation={{ value: "REBUILD", label: "Type REBUILD to confirm" }}
      />

      <ConfirmDialog
        open={showWipeConfirm}
        onOpenChange={setShowWipeConfirm}
        title="Wipe Library Database"
        description="This will permanently delete ALL library data (artists, albums, tracks) from the database. Files on disk will NOT be affected. This action cannot be undone."
        confirmLabel="Wipe Database"
        variant="destructive"
        onConfirm={() => {
          void (async () => {
            try {
              await api("/api/manage/wipe", "POST", { rebuild: false });
              toast.success("Library database wiped");
              void refresh(true);
            } catch {
              toast.error("Failed to wipe database");
            }
          })();
        }}
        eyebrow="Confirm action"
        consequence="Database only · files remain on disk"
        confirmation={{ value: "WIPE", label: "Type WIPE to confirm" }}
      />
    </div>
  );
}
