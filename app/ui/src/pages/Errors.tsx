import { useSearchParams } from "react-router";

import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { RefreshCw } from "@crate/ui/icons";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Button } from "@crate/ui/shadcn/button";

import { OpsPageHero, OpsPanel } from "@/components/admin/ops-surfaces";
import { RelativeTime } from "@/components/admin/RelativeTime";
import { useCursorList } from "@/components/agents/connections/use-cursor-list";
import {
  ConnectionPanel,
  focusConnectionPanel,
} from "@/components/errors/ConnectionPanel";
import { IssueTable } from "@/components/errors/IssueTable";
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
  type ErrorIssueSummary,
  type ErrorSummary,
  type IssueFilters,
  type LaneFilter,
  type StatusFilter,
} from "@/lib/error-inbox";

const SUMMARY_URL = `${ERRORS_API}/summary`;

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

function ConnectionPointer({ code }: { code?: string | null }) {
  const { hasCapability } = useAuth();
  if (!hasCapability(RUNTIME_MANAGE))
    return code === undefined || needsConnectionFix(code) ? (
      <p className="text-sm text-text-muted">
        Someone who manages the runtime can fix it in the Sentry connection.
      </p>
    ) : null;
  if (code !== undefined && !needsConnectionFix(code)) return null;
  return (
    <Button type="button" variant="outline" onClick={focusConnectionPanel}>
      Open the Sentry connection
    </Button>
  );
}

function SyncNotice({ summary }: { summary: ErrorSummary }) {
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
      <ConnectionPointer code={sync.error_code} />
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
        <AdminSelect
          ariaLabel="Classification"
          value={filters.classification}
          onChange={(value) => set("classification", value)}
          placeholder="All classes"
          allowClear
          options={Object.entries(CLASSIFICATION_LABEL).map(
            ([value, label]) => ({ value, label }),
          )}
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
}: {
  summary: ErrorSummary;
  filters: IssueFilters;
  onClear: () => void;
}) {
  const { sync } = summary;
  if (sync?.status === "failed")
    return (
      <EmptyState
        title={problemTitle(sync.error_code)}
        description={problemText(sync.error_code)}
        action={<ConnectionPointer code={sync.error_code} />}
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
 * as worker tasks. Filters live in the URL.
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

  const data = summary.data;
  const header = (
    <OpsPageHero
      title="Errors"
      description="Sentry issues, synced every 5 minutes and ordered by Crate priority. Changing a status here changes it in Sentry."
      compactActions
      actions={
        <PageHeaderActions>
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

  if (!data)
    return (
      <div className="space-y-6">
        {header}
        {summary.loading ? (
          <LoadingState label="Loading errors" />
        ) : (
          <ErrorState
            message="Could not load the error inbox."
            onRetry={summary.refetch}
          />
        )}
      </div>
    );

  if (!data.configured)
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          variant="panel"
          titleAs="h2"
          title="Error tracking is not set up"
          description="Connect a Sentry organization to see its issues here. Crate reads them every 5 minutes; the only thing it sends to Sentry is a status change someone makes."
          action={<ConnectionPointer />}
        />
        {canManageRuntime ? <ConnectionPanel onChanged={refresh} /> : null}
      </div>
    );

  const releases = knownReleases(list.items);
  return (
    <div className="space-y-6">
      {header}
      {/* With no rows, the empty state already explains a failed sync. */}
      {list.items.length > 0 ? <SyncNotice summary={data} /> : null}
      <OpsPanel title="Filters">
        <Filters
          filters={filters}
          summary={data}
          releases={releases}
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
                    <p role="alert" className="text-sm text-state-warning-text">
                      Could not load more issues.
                    </p>
                  ) : null}
                </div>
              ) : null
            }
          />
        )}
      </OpsPanel>
      {canManageRuntime ? <ConnectionPanel onChanged={refresh} /> : null}
    </div>
  );
}
