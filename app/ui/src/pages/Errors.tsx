import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";

import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { RefreshCw } from "@crate/ui/icons";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import {
  SegmentedControl,
  type SegmentedControlItem,
} from "@crate/ui/primitives/SegmentedControl";
import { StatusDot, type StatusDotTone } from "@crate/ui/primitives/StatusDot";
import { Button } from "@crate/ui/shadcn/button";

import { OpsPageHero, OpsPanel } from "@/components/admin/ops-surfaces";
import { RelativeTime } from "@/components/admin/RelativeTime";
import { useCursorList } from "@/components/agents/connections/use-cursor-list";
import { ConnectionSheet } from "@/components/errors/ConnectionSheet";
import { IssueTable } from "@/components/errors/IssueTable";
import { TriageBacklog } from "@/components/errors/TriageBacklog";
import {
  PageHeaderAction,
  PageHeaderActions,
} from "@/components/layout/PageHeader";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import {
  CLASSIFICATION_LABEL,
  DEFAULT_FILTERS,
  ERRORS_API,
  RUNTIME_MANAGE,
  filtersFromParams,
  filtersToParams,
  formatCount,
  hasActiveFilters,
  issuesUrl,
  knownReleases,
  needsConnectionFix,
  problemText,
  problemTitle,
  type ClassFilter,
  type ErrorIssueSummary,
  type ErrorSummary,
  type IssueClassification,
  type IssueFilters,
  type LaneFilter,
  type StatusFilter,
} from "@/lib/error-inbox";

const SUMMARY_URL = `${ERRORS_API}/summary`;

// Five fixed classes: short static choices use chips, like Lane and Status.
const CLASS_ITEMS: SegmentedControlItem<ClassFilter>[] = [
  { value: "all", label: "All" },
  ...(
    Object.entries(CLASSIFICATION_LABEL) as [IssueClassification, string][]
  ).map(([value, label]) => ({ value, label })),
];

const issueId = (issue: ErrorIssueSummary) => issue.id;

function SyncBadge({ summary }: { summary: ErrorSummary }) {
  const { sync } = summary;
  if (!summary.configured) return <InfoBadge>Not configured</InfoBadge>;
  if (!sync) return <InfoBadge>Waiting for the first sync</InfoBadge>;
  if (sync.status === "failed")
    return <InfoBadge tone="warning">Last sync failed</InfoBadge>;
  return (
    <InfoBadge tone={sync.status === "partial" ? "warning" : "neutral"}>
      {sync.status === "partial" ? "Partial sync" : "Synced"}{" "}
      {summary.last_synced_at ? (
        <RelativeTime value={summary.last_synced_at} />
      ) : null}
    </InfoBadge>
  );
}

type OpenConnection = (event: MouseEvent<HTMLElement>) => void;

/** A quiet reading of the connection for the header button, from the summary. */
function connectionDot(summary: ErrorSummary | null): {
  tone: StatusDotTone;
  label: string;
} | null {
  if (!summary) return null;
  if (!summary.configured) return { tone: "off", label: "not configured" };
  if (summary.sync?.status === "failed")
    return {
      tone: "warn",
      label: needsConnectionFix(summary.sync.error_code)
        ? "needs attention"
        : "sync failing",
    };
  return { tone: "on", label: "connected" };
}

function ConnectionPointer({
  code,
  onOpen,
}: {
  code?: string | null;
  onOpen: OpenConnection;
}) {
  const { hasCapability } = useAuth();
  if (!hasCapability(RUNTIME_MANAGE))
    return code === undefined || needsConnectionFix(code) ? (
      <p className="text-sm text-text-muted">
        Someone who manages the runtime can fix it in the Sentry connection.
      </p>
    ) : null;
  if (code !== undefined && !needsConnectionFix(code)) return null;
  return (
    <Button
      type="button"
      variant="outline"
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      Open the Sentry connection
    </Button>
  );
}

function SyncNotice({
  summary,
  onOpenConnection,
}: {
  summary: ErrorSummary;
  onOpenConnection: OpenConnection;
}) {
  const { sync } = summary;
  if (!sync || sync.status === "ok") return null;
  if (sync.status === "partial")
    return (
      <p role="status" className="text-sm text-text-muted">
        The last sync stopped early
        {sync.truncated.full || sync.truncated.recent
          ? " at the page limit"
          : ""}
        . Some issues may be missing until the next pass.
      </p>
    );
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-state-warning/25 bg-state-warning/[0.06] px-4 py-3 text-sm text-text-secondary"
    >
      <span>
        {problemText(sync.error_code)}{" "}
        {sync.last_success_at ? (
          <>
            Showing issues from the last good sync,{" "}
            <RelativeTime value={sync.last_success_at} />.
          </>
        ) : null}
      </span>
      <ConnectionPointer code={sync.error_code} onOpen={onOpenConnection} />
    </div>
  );
}

function Filters({
  filters,
  summary,
  releases,
  onChange,
}: {
  filters: IssueFilters;
  summary: ErrorSummary;
  releases: string[];
  onChange: (next: IssueFilters) => void;
}) {
  const set = <K extends keyof IssueFilters>(key: K, value: IssueFilters[K]) =>
    onChange({ ...filters, [key]: value });
  const releaseOptions =
    filters.release && !releases.includes(filters.release)
      ? [filters.release, ...releases]
      : releases;
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
      <div className="crate-form-field">
        <MonoLabel as="span">Lane</MonoLabel>
        <SegmentedControl<LaneFilter>
          as="radio"
          label="Lane"
          value={filters.lane}
          onValueChange={(value) => set("lane", value)}
          items={[
            { value: "all", label: "All" },
            { value: "critical", label: "Critical" },
          ]}
        />
      </div>
      <div className="crate-form-field">
        <MonoLabel as="span">Status</MonoLabel>
        <SegmentedControl<StatusFilter>
          as="radio"
          label="Status"
          value={filters.status}
          onValueChange={(value) => set("status", value)}
          items={[
            { value: "unresolved", label: "Open" },
            { value: "resolved", label: "Resolved" },
            { value: "ignored", label: "Ignored" },
            { value: "all", label: "All" },
          ]}
        />
      </div>
      <div className="crate-form-field">
        <MonoLabel as="span">Service</MonoLabel>
        <AdminSelect
          ariaLabel="Service"
          value={filters.service}
          onChange={(value) => set("service", value)}
          placeholder="All services"
          allowClear
          options={summary.services.map((entry) => ({
            value: entry.service,
            label: entry.service,
            count: entry.open,
          }))}
        />
      </div>
      <div className="crate-form-field">
        <MonoLabel as="span">Class</MonoLabel>
        <SegmentedControl<ClassFilter>
          as="radio"
          label="Class"
          value={(filters.classification || "all") as ClassFilter}
          onValueChange={(value) =>
            set("classification", value === "all" ? "" : value)
          }
          items={CLASS_ITEMS}
        />
      </div>
      <div className="crate-form-field">
        <MonoLabel as="span">Release</MonoLabel>
        <AdminSelect
          ariaLabel="Release"
          value={filters.release}
          onChange={(value) => set("release", value)}
          placeholder="All releases"
          allowClear
          searchable
          searchPlaceholder="Filter releases…"
          options={releaseOptions.map((release) => ({
            value: release,
            label: release,
          }))}
        />
      </div>
    </div>
  );
}

function EmptyIssues({
  summary,
  filters,
  onClear,
  onOpenConnection,
}: {
  summary: ErrorSummary;
  filters: IssueFilters;
  onClear: () => void;
  onOpenConnection: OpenConnection;
}) {
  const { sync } = summary;
  if (sync?.status === "failed")
    return (
      <EmptyState
        title={problemTitle(sync.error_code)}
        description={problemText(sync.error_code)}
        action={
          <ConnectionPointer code={sync.error_code} onOpen={onOpenConnection} />
        }
      />
    );
  if (hasActiveFilters(filters))
    return (
      <EmptyState
        title="No matching issues"
        description="No issues match these filters."
        action={
          <Button type="button" variant="outline" onClick={onClear}>
            Clear filters
          </Button>
        }
      />
    );
  if (!sync)
    return (
      <EmptyState
        title="Waiting for the first sync"
        description="Crate reads Sentry every 5 minutes. Issues appear here after the first pass."
      />
    );
  return (
    <EmptyState
      title="No open issues"
      description="Sentry reports nothing open for the connected projects."
    />
  );
}

/**
 * The Error Inbox: Sentry issues synced into PostgreSQL by a worker every five
 * minutes. Reads never call Sentry; status changes and the connection test run
 * as worker tasks. Filters live in the URL. People who manage the runtime
 * configure the Sentry connection in a side drawer.
 */
export function Errors() {
  const { hasCapability } = useAuth();
  const canManageRuntime = hasCapability(RUNTIME_MANAGE);
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params);
  const summary = useApi<ErrorSummary>(SUMMARY_URL);
  const configured = summary.data?.configured;
  // Load the list alongside the summary; skip it only once we know nothing is set up.
  const list = useCursorList<ErrorIssueSummary>(
    configured === false ? null : issuesUrl(filters),
    issueId,
  );

  function changeFilters(next: IssueFilters) {
    setParams(filtersToParams(next), { replace: true });
  }

  function refresh() {
    summary.refetch();
    list.reload();
  }

  // Several controls open the connection drawer; closing it returns focus to
  // the one that did (ConnectionSheet falls back to the header button).
  const [connectionOpen, setConnectionOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const connectionButtonRef = useRef<HTMLButtonElement>(null);
  const openConnection: OpenConnection = (event) => {
    openerRef.current = event.currentTarget;
    setConnectionOpen(true);
  };

  const data = summary.data;
  const dot = connectionDot(data);
  const header = (
    <OpsPageHero
      title="Errors"
      description="Sentry issues, synced every 5 minutes and ordered by Crate priority. Changing a status here changes it in Sentry."
      compactActions
      actions={
        <PageHeaderActions>
          {canManageRuntime ? (
            <Button
              ref={connectionButtonRef}
              type="button"
              variant="ghost"
              aria-haspopup="dialog"
              aria-expanded={connectionOpen}
              onClick={openConnection}
            >
              {dot ? <StatusDot tone={dot.tone} /> : null}
              Sentry connection
              {dot ? <span className="sr-only">, {dot.label}</span> : null}
            </Button>
          ) : null}
          <PageHeaderAction label="Refresh" onClick={refresh}>
            <RefreshCw data-admin-ux="header-refresh" aria-hidden="true" />
          </PageHeaderAction>
        </PageHeaderActions>
      }
    >
      {data?.configured ? (
        <>
          <InfoBadge>{formatCount(data.open)} open</InfoBadge>
          {data.critical_open > 0 ? (
            <InfoBadge tone="warning">
              {formatCount(data.critical_open)} critical
            </InfoBadge>
          ) : null}
        </>
      ) : null}
      {data ? <SyncBadge summary={data} /> : null}
    </OpsPageHero>
  );

  let body: ReactNode;
  if (!data)
    body = summary.loading ? (
      <LoadingState label="Loading errors" />
    ) : (
      <ErrorState
        message="Could not load the error inbox."
        onRetry={summary.refetch}
      />
    );
  else if (!data.configured)
    body = (
      <EmptyState
        variant="panel"
        titleAs="h2"
        title="Error tracking is not set up"
        description="Connect a Sentry organization to see its issues here. Crate reads them every 5 minutes; the only thing it sends to Sentry is a status change someone makes."
        action={<ConnectionPointer onOpen={openConnection} />}
      />
    );
  else
    body = (
      <>
        {/* With no rows, the empty state already explains a failed sync. */}
        {list.items.length > 0 ? (
          <SyncNotice summary={data} onOpenConnection={openConnection} />
        ) : null}
        <TriageBacklog untriaged={data.untriaged ?? 0} onQueued={refresh} />
        <OpsPanel title="Filters">
          <Filters
            filters={filters}
            summary={data}
            releases={knownReleases(list.items)}
            onChange={changeFilters}
          />
        </OpsPanel>
        <OpsPanel
          title="Issues"
          action={
            list.items.length > 0 ? (
              <MonoLabel as="span">
                {formatCount(list.items.length)} loaded
              </MonoLabel>
            ) : null
          }
        >
          {list.loading ? (
            <LoadingState label="Loading issues" />
          ) : list.error && list.items.length === 0 ? (
            <ErrorState message="Could not load issues." onRetry={list.retry} />
          ) : list.items.length === 0 ? (
            <EmptyIssues
              summary={data}
              filters={filters}
              onClear={() => changeFilters(DEFAULT_FILTERS)}
              onOpenConnection={openConnection}
            />
          ) : (
            <IssueTable
              issues={list.items}
              footer={
                list.nextCursor || list.moreFailed ? (
                  <div className="flex flex-wrap items-center gap-3 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={list.loadingMore}
                      aria-busy={list.loadingMore || undefined}
                      onClick={list.moreFailed ? list.retry : list.loadMore}
                    >
                      {list.loadingMore
                        ? "Loading…"
                        : list.moreFailed
                          ? "Retry loading more"
                          : "Load more"}
                    </Button>
                    {list.moreFailed ? (
                      <p
                        role="alert"
                        className="text-sm text-state-warning-text"
                      >
                        Could not load more issues.
                      </p>
                    ) : null}
                  </div>
                ) : null
              }
            />
          )}
        </OpsPanel>
      </>
    );

  // One tree for every state, so saving in the drawer (which can turn "not
  // configured" into the inbox) keeps the drawer open.
  return (
    <div className="space-y-6">
      {header}
      {body}
      {canManageRuntime ? (
        <ConnectionSheet
          open={connectionOpen}
          onOpenChange={setConnectionOpen}
          onChanged={refresh}
          returnFocusRef={openerRef}
          fallbackFocusRef={connectionButtonRef}
        />
      ) : null}
    </div>
  );
}
