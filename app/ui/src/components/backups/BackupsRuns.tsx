import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { ChevronDown, ChevronRight } from "@crate/ui/icons";
import { cn } from "@crate/ui/lib/cn";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Button } from "@crate/ui/shadcn/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@crate/ui/shadcn/table";

import { AdminSelect } from "@/components/ui/AdminSelect";
import { apiErrorText } from "@/lib/agent-plan-presentation";
import { api } from "@/lib/api";
import {
  BACKUPS_API,
  RUN_KIND_LABEL,
  formatBackupBytes,
  formatSeconds,
  formatStamp,
  type BackupDestinationHealth,
  type BackupRun,
  type BackupRunList,
} from "@/lib/backups";

import { severityTextClass } from "@/components/admin/status-indicators";

import { CopyAction, RunStatusDot } from "./backup-ui";

const TH = "font-mono text-label uppercase tracking-caps";
const PAGE = 50;

type KindFilter =
  "all" | "dump" | "local_retention" | "offsite" | "verify" | "restore_drill";
type StatusFilter = "all" | "running" | "succeeded" | "failed";

const DATES: { value: string; label: string; hours: number | null }[] = [
  { value: "24h", label: "Last 24 hours", hours: 24 },
  { value: "7d", label: "Last 7 days", hours: 24 * 7 },
  { value: "14d", label: "Last 14 days", hours: 24 * 14 },
  { value: "30d", label: "Last 30 days", hours: 24 * 30 },
  { value: "all", label: "Any date", hours: null },
];

export interface RunFilters {
  kind: KindFilter;
  status: StatusFilter;
  destination: string;
  date: string;
}

export function runsUrl(
  filters: RunFilters,
  offset: number,
  now: number,
): string {
  const params = new URLSearchParams({
    limit: String(PAGE),
    offset: String(offset),
  });
  if (filters.kind !== "all") params.set("kind", filters.kind);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.destination) params.set("destination_id", filters.destination);
  const hours = DATES.find((d) => d.value === filters.date)?.hours;
  if (hours)
    params.set("since", new Date(now - hours * 3_600_000).toISOString());
  return `${BACKUPS_API}/runs?${params}`;
}

function shortId(value?: string | null) {
  if (!value) return "—";
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
}

/** "1.31 GB added", "0.8 GB read", "1 dump deleted", "48,212 tracks checked". */
export function runSize(run: BackupRun): string {
  const details = run.details ?? {};
  if (run.kind === "offsite")
    return run.bytes != null ? `${formatBackupBytes(run.bytes)} added` : "—";
  if (run.kind === "dump")
    return run.bytes != null ? formatBackupBytes(run.bytes) : "—";
  if (run.kind === "local_retention") {
    const deleted = Array.isArray(details.deleted)
      ? details.deleted.length
      : null;
    return deleted == null
      ? "—"
      : `${deleted} dump${deleted === 1 ? "" : "s"} deleted`;
  }
  if (run.kind === "verify")
    return typeof details.read_percent === "number"
      ? `${details.read_percent}% read`
      : "—";
  if (run.kind === "restore_drill") {
    const rows = details.rows as Record<string, unknown> | undefined;
    const tracks = rows?.library_tracks;
    if (typeof tracks === "number")
      return `${tracks.toLocaleString("en-US")} tracks checked`;
    return typeof details.tables === "number"
      ? `${details.tables} tables restored`
      : "—";
  }
  return "—";
}

function RunDetail({
  run,
  onOpenDestination,
  onRetry,
}: {
  run: BackupRun;
  onOpenDestination: (id: string) => void;
  onRetry: (run: BackupRun) => void;
}) {
  const failed = run.status === "failed";
  const facts: [string, string][] = [
    ["Run", shortId(run.id)],
    ["Task", run.task_id ? `${run.kind} · ${shortId(run.task_id)}` : "—"],
    ["Started", formatStamp(run.started_at)],
    [
      "Duration",
      run.status === "running"
        ? "Running"
        : formatSeconds(run.duration_seconds),
    ],
  ];
  if (run.path) facts.push(["Dump", run.path.split("/").pop() ?? run.path]);
  if (run.checksum) facts.push(["Checksum", run.checksum]);
  if (run.snapshot_id) facts.push(["Snapshot", run.snapshot_id.slice(0, 8)]);
  const tags = run.details?.tags;
  if (Array.isArray(tags) && tags.length)
    facts.push(["Tiers", tags.join(", ")]);
  return (
    <div
      className={cn(
        "space-y-4 rounded-md border p-4",
        failed
          ? "border-border-quiet bg-raised-surface"
          : "border-border-quiet bg-raised-surface",
      )}
    >
      {failed ? (
        <div className="space-y-2">
          <MonoLabel as="p">Error</MonoLabel>
          <pre
            className={cn(
              "m-0 whitespace-pre-wrap break-all font-mono text-label",
              severityTextClass("error"),
            )}
          >
            {run.error || "The run failed without a message"}
          </pre>
        </div>
      ) : null}
      <dl className="m-0 grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="font-mono text-label uppercase tracking-caps text-text-subtle">
              {label}
            </dt>
            <dd className="m-0 mt-1 truncate font-mono text-sm text-text-primary">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {run.task_id ? (
          <Button asChild size="sm" variant="outline">
            <Link to={`/tasks?task=${encodeURIComponent(run.task_id)}`}>
              Open task
            </Link>
          </Button>
        ) : null}
        {run.destination_id ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onOpenDestination(run.destination_id!)}
          >
            Open destination
          </Button>
        ) : null}
        {failed ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onRetry(run)}
          >
            Retry now
          </Button>
        ) : null}
        {failed && run.error ? (
          <CopyAction value={run.error} label="Copy error" />
        ) : null}
      </div>
    </div>
  );
}

/** Run history with filters and paging (mockup 4). Successful runs stay quiet. */
export function BackupsRuns({
  destinations,
  onOpenDestination,
  onRetry,
  now = Date.now(),
}: {
  destinations: readonly BackupDestinationHealth[];
  onOpenDestination: (id: string) => void;
  onRetry: (run: BackupRun) => void;
  now?: number;
}) {
  const [filters, setFilters] = useState<RunFilters>({
    kind: "all",
    status: "all",
    destination: "",
    date: "14d",
  });
  const [runs, setRuns] = useState<BackupRun[]>([]);
  const [page, setPage] = useState<BackupRunList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const nowRef = useRef(now);
  const request = useRef(0);

  async function load(offset: number) {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api<BackupRunList>(
        runsUrl(filters, offset, nowRef.current),
      );
      if (id !== request.current) return;
      setPage(result);
      setRuns((current) =>
        offset ? [...current, ...result.items] : result.items,
      );
    } catch (err) {
      if (id !== request.current) return;
      setError(apiErrorText(err, "The runs could not be loaded"));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load(0);
  }, [filters.kind, filters.status, filters.destination, filters.date]);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const dateLabel = DATES.find(
    (d) => d.value === filters.date,
  )?.label.toLowerCase();
  const failed = runs.filter((r) => r.status === "failed").length;
  const running = runs.filter((r) => r.status === "running").length;
  const summary = page
    ? [
        `${page.total} run${page.total === 1 ? "" : "s"}${
          filters.date === "all" ? "" : ` in the ${dateLabel}`
        }`,
        failed ? `${failed} failed` : null,
        running ? `${running} running` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="crate-form-field">
          <MonoLabel as="span">Kind</MonoLabel>
          <SegmentedControl<KindFilter>
            as="radio"
            label="Kind"
            value={filters.kind}
            onValueChange={(kind) => setFilters({ ...filters, kind })}
            items={[
              { value: "all", label: "All" },
              { value: "dump", label: "Dump" },
              { value: "local_retention", label: "Local retention" },
              { value: "offsite", label: "Off-site" },
              { value: "verify", label: "Verify" },
              { value: "restore_drill", label: "Restore drill" },
            ]}
          />
        </div>
        <div className="crate-form-field">
          <MonoLabel as="span">Status</MonoLabel>
          <SegmentedControl<StatusFilter>
            as="radio"
            label="Status"
            value={filters.status}
            onValueChange={(status) => setFilters({ ...filters, status })}
            items={[
              { value: "all", label: "All" },
              { value: "running", label: "Running" },
              { value: "succeeded", label: "Succeeded" },
              { value: "failed", label: "Failed" },
            ]}
          />
        </div>
        <div className="crate-form-field">
          <MonoLabel as="span">Destination</MonoLabel>
          <AdminSelect
            ariaLabel="Destination"
            value={filters.destination}
            onChange={(destination) => setFilters({ ...filters, destination })}
            placeholder="All destinations"
            allowClear
            triggerClassName="w-56"
            options={destinations.map((d) => ({ value: d.id, label: d.name }))}
          />
        </div>
        <div className="crate-form-field">
          <MonoLabel as="span">Date</MonoLabel>
          <SegmentedControl
            as="radio"
            label="Date"
            value={filters.date}
            onValueChange={(date) => setFilters({ ...filters, date })}
            items={DATES.map(({ value, label }) => ({ value, label }))}
          />
        </div>
      </div>

      {error && !runs.length ? (
        <ErrorState
          title="Runs unavailable"
          message={error}
          onRetry={() => void load(0)}
        />
      ) : loading && !page ? (
        <LoadingState variant="section" />
      ) : !runs.length ? (
        <EmptyState
          title="No runs"
          description="No backup run matches these filters."
        />
      ) : (
        <div className="space-y-3">
          <span role="status" className="text-xs text-text-muted">
            {summary}
          </span>
          <div className="min-w-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={cn(TH, "w-8")}>
                    <span className="sr-only">Details</span>
                  </TableHead>
                  <TableHead className={TH}>Started</TableHead>
                  <TableHead className={TH}>Kind</TableHead>
                  <TableHead className={TH}>Destination</TableHead>
                  <TableHead className={TH}>Policy</TableHead>
                  <TableHead className={TH}>Status</TableHead>
                  <TableHead className={cn(TH, "text-right")}>
                    Duration
                  </TableHead>
                  <TableHead className={cn(TH, "text-right")}>
                    Size / added
                  </TableHead>
                  <TableHead className={TH}>Snapshot</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => {
                  const open = expanded.has(run.id);
                  const kind = RUN_KIND_LABEL[run.kind] ?? run.kind;
                  const started = formatStamp(run.started_at);
                  return (
                    <Fragment key={run.id}>
                      <TableRow
                        className={cn(
                          "border-border-quiet-subtle",
                          open && "border-b-0 bg-surface-control",
                        )}
                      >
                        <TableCell className="py-1.5">
                          <button
                            type="button"
                            aria-expanded={open}
                            aria-controls={`run-${run.id}`}
                            aria-label={`Details of the ${kind} run of ${started}${
                              run.destination_name
                                ? ` to ${run.destination_name}`
                                : ""
                            }`}
                            onClick={() => toggle(run.id)}
                            className="flex size-8 items-center justify-center rounded-md text-text-muted pointer-coarse:size-11 hover:text-text-primary"
                          >
                            {open ? (
                              <ChevronDown
                                data-admin-ux="backups-run-collapse"
                                aria-hidden="true"
                              />
                            ) : (
                              <ChevronRight
                                data-admin-ux="backups-run-expand"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-1.5 font-mono text-xs text-text-secondary">
                          {started}
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-1.5 text-sm text-text-primary">
                          {kind}
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-1.5 text-sm text-text-secondary">
                          {run.destination_name ?? "—"}
                        </TableCell>
                        <TableCell className="py-1.5 text-sm text-text-secondary">
                          {run.policy_name ?? "Manual"}
                        </TableCell>
                        <TableCell className="py-1.5">
                          <RunStatusDot status={run.status} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-1.5 text-right font-mono text-sm text-text-secondary">
                          {run.status === "running" && !run.finished_at
                            ? formatSeconds(
                                (now - Date.parse(run.started_at)) / 1000,
                              )
                            : formatSeconds(run.duration_seconds)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap py-1.5 text-right font-mono text-sm text-text-secondary">
                          {runSize(run)}
                        </TableCell>
                        <TableCell className="py-1.5 font-mono text-sm text-text-secondary">
                          {run.snapshot_id ? run.snapshot_id.slice(0, 8) : "—"}
                        </TableCell>
                      </TableRow>
                      {open ? (
                        <TableRow className="border-border-quiet-subtle bg-surface-control hover:bg-surface-control">
                          <TableCell
                            id={`run-${run.id}`}
                            colSpan={9}
                            className="whitespace-normal px-4 pb-4 pt-0"
                          >
                            <RunDetail
                              run={run}
                              onOpenDestination={onOpenDestination}
                              onRetry={onRetry}
                            />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {page?.has_more ? (
            <div className="flex justify-center pt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={loading}
                aria-busy={loading || undefined}
                onClick={() => void load(runs.length)}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
