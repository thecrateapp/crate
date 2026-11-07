import { useState, type ReactNode } from "react";
import { useParams } from "react-router";

import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { BackLink } from "@crate/ui/domain/navigation/BackLink";
import { LoadingState } from "@crate/ui/domain/states/LoadingState";
import { ErrorState } from "@crate/ui/primitives/ErrorState";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { Button } from "@crate/ui/shadcn/button";

import {
  AdminPageHeader,
  OpsPanel,
  OpsStatTile,
} from "@/components/admin/ops-surfaces";
import { RelativeTime } from "@/components/admin/RelativeTime";
import { SeverityMeter } from "@/components/admin/status-indicators";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import { InvestigateAction } from "@/components/errors/InvestigateAction";
import { IssueStatusActions } from "@/components/errors/IssueStatusActions";
import { FixRequestState, LaunchFix } from "@/components/errors/LaunchFix";
import { StackFrames } from "@/components/errors/StackFrames";
import { TriagePanel, suspectedFrames } from "@/components/errors/TriagePanel";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import {
  CLASSIFICATION_LABEL,
  ERRORS_MANAGE,
  STATUS_LABEL,
  formatCount,
  issueUrl,
  substatusLabel,
  substatusTone,
  type Digest,
  type ErrorIssueDetail,
} from "@/lib/error-inbox";

function Fact({ label, children }: { label: string; children: ReactNode }) {
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

function releaseText(issue: ErrorIssueDetail): string {
  const { first_release: first, last_release: last } = issue;
  if (!first && !last) return "—";
  if (!first || !last || first === last) return (first ?? last)!;
  return `${first} → ${last}`;
}

function ExceptionChain({ digest }: { digest: Digest }) {
  // The digest keeps Sentry's order (cause first); show the raised one first.
  const chain = [...digest.exceptions].reverse();
  if (chain.length === 0)
    return (
      <p className="font-mono text-sm text-text-secondary wrap-anywhere">
        {digest.message ?? "Sentry sent no exception for this event."}
      </p>
    );
  return (
    <ol className="list-none border-t border-border-quiet p-0">
      {chain.map((exception, index) => (
        <li
          key={index}
          className="grid gap-1 border-b border-border-quiet py-3"
        >
          <MonoLabel as="span" tone={index === 0 ? "accent" : "subtle"}>
            {index === 0 ? "Raised" : "Caused by"}
            {exception.handled === false ? " · unhandled" : ""}
            {exception.mechanism ? ` · ${exception.mechanism}` : ""}
          </MonoLabel>
          <p className="font-mono text-sm text-text-primary wrap-anywhere">
            {exception.module ? `${exception.module}.` : ""}
            {exception.type ?? "Error"}
          </p>
          <p className="text-sm text-text-secondary wrap-anywhere">
            {exception.value}
          </p>
        </li>
      ))}
    </ol>
  );
}

function Tags({ tags }: { tags: Record<string, string> }) {
  const entries = Object.entries(tags);
  if (entries.length === 0)
    return <p className="text-sm text-text-muted">No tags on this event.</p>;
  return (
    <dl className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map(([key, value]) => (
        <Fact key={key} label={key}>
          {value}
        </Fact>
      ))}
    </dl>
  );
}

function Breadcrumbs({ crumbs }: { crumbs: Digest["breadcrumbs"] }) {
  if (crumbs.length === 0)
    return (
      <p className="text-sm text-text-muted">No breadcrumbs on this event.</p>
    );
  return (
    <ol
      aria-label="Breadcrumbs, oldest first"
      className="list-none border-t border-border-quiet p-0"
    >
      {crumbs.map((crumb, index) => (
        <li
          key={index}
          className="grid gap-x-4 gap-y-1 border-b border-border-quiet py-2.5 sm:grid-cols-[8rem_6rem_minmax(0,1fr)]"
        >
          <span className="font-mono text-label text-text-muted">
            {crumb.category ?? "—"}
          </span>
          <SeverityMeter level={crumb.level} label={crumb.level ?? "—"} />
          <span className="min-w-0 font-mono text-label text-text-secondary wrap-anywhere">
            {crumb.message}
          </span>
        </li>
      ))}
    </ol>
  );
}

function IssueView({
  issue,
  onChanged,
}: {
  issue: ErrorIssueDetail;
  onChanged: () => void;
}) {
  const { hasCapability } = useAuth();
  const canManage = hasCapability(ERRORS_MANAGE);
  const [investigating, setInvestigating] = useState(false);
  const substatus = substatusLabel(issue.substatus);
  const digest = issue.digest;
  const suspected = suspectedFrames(issue);
  return (
    <div className="min-w-0 space-y-6 pb-8">
      <BackLink to="/errors" label="Back to errors" />
      <AdminPageHeader className="space-y-4">
        <div>
          {/* Error titles run long: the medium page-title size keeps them readable. */}
          <h1 className="crate-page-title wrap-anywhere" data-size="md">
            {issue.title}
          </h1>
          <p className="mt-3 font-mono text-label text-text-muted wrap-anywhere">
            {issue.culprit ?? "Sentry reported no culprit."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <InfoBadge>{issue.short_id}</InfoBadge>
          <InfoBadge>{issue.service}</InfoBadge>
          <SeverityMeter level={issue.level} label={issue.level} />
          <StatusBadge>{STATUS_LABEL[issue.status]}</StatusBadge>
          {substatus ? (
            <StatusBadge tone={substatusTone(issue.substatus)}>
              {substatus}
            </StatusBadge>
          ) : null}
          {issue.critical ? (
            <StatusBadge tone="warning">Critical lane</StatusBadge>
          ) : null}
          {issue.classification ? (
            <InfoBadge>{CLASSIFICATION_LABEL[issue.classification]}</InfoBadge>
          ) : null}
        </div>
      </AdminPageHeader>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        {canManage ? (
          <InvestigateAction
            issue={issue}
            onChanged={onChanged}
            onPendingChange={setInvestigating}
          />
        ) : null}
        {canManage && issue.write_access !== false ? (
          <IssueStatusActions issue={issue} onChanged={onChanged} />
        ) : null}
        {canManage && issue.fix ? (
          <LaunchFix issue={issue} fix={issue.fix} onChanged={onChanged} />
        ) : null}
        {issue.permalink ? (
          <Button asChild variant="ghost">
            <a href={issue.permalink} target="_blank" rel="noopener noreferrer">
              Open in Sentry
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </Button>
        ) : null}
      </div>
      {canManage && issue.write_access === false ? (
        <p role="note" className="text-sm text-text-muted">
          Status changes are unavailable: the Sentry token cannot change issues
          (it lacks event:write). Resolve or ignore this issue in Sentry, or
          store a token with that scope.
        </p>
      ) : null}
      <FixRequestState issue={issue} />

      <section
        aria-label="Issue metrics"
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-3"
      >
        <OpsStatTile
          label="Events 24h"
          value={formatCount(issue.events_24h)}
          caption={`${formatCount(issue.events_total)} in total`}
        />
        <OpsStatTile
          label="Users 24h"
          value={formatCount(issue.users_24h)}
          caption={`${formatCount(issue.users_total)} in total`}
        />
        <OpsStatTile
          label="Crate score"
          value={issue.crate_score}
          caption={issue.critical ? "Critical lane" : "Below the critical lane"}
          tone={issue.critical ? "warning" : "default"}
        />
        <OpsStatTile
          label="Sentry priority"
          value={issue.sentry_priority ?? "—"}
          caption={issue.issue_category ?? "Issue"}
        />
      </section>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
        <Fact label="First seen">
          <RelativeTime value={issue.first_seen} />
        </Fact>
        <Fact label="Last seen">
          <RelativeTime value={issue.last_seen} />
        </Fact>
        <Fact label="Releases">{releaseText(issue)}</Fact>
        <Fact label="Synced">
          <RelativeTime value={issue.synced_at} />
        </Fact>
      </dl>

      {digest ? (
        <>
          <OpsPanel title="Exception">
            <ExceptionChain digest={digest} />
          </OpsPanel>
          <OpsPanel
            title="Stack trace"
            description={
              suspected.length > 0
                ? "In-app frames, innermost first. Source lines are the ones Sentry stored for the release that failed. Suspected frames come from the AI assessment below."
                : "In-app frames, innermost first. Source lines are the ones Sentry stored for the release that failed."
            }
          >
            {digest.frames.length > 0 ? (
              <StackFrames frames={digest.frames} suspected={suspected} />
            ) : (
              <p className="text-sm text-text-muted">
                No frames from Crate code in this event.
              </p>
            )}
          </OpsPanel>
          <OpsPanel title="Tags">
            <Tags tags={digest.tags} />
          </OpsPanel>
          <OpsPanel title="Breadcrumbs">
            <Breadcrumbs crumbs={digest.breadcrumbs} />
          </OpsPanel>
          {digest.truncated ? (
            <p className="text-sm text-text-muted">
              This summary was trimmed to stay small: older breadcrumbs or
              context lines were dropped.
            </p>
          ) : null}
        </>
      ) : (
        <OpsPanel title="Event">
          <EmptyState
            title="No event summary yet"
            description="Each sync downloads the latest event of up to 25 issues, highest score first. This one has not been reached yet."
          />
        </OpsPanel>
      )}

      <OpsPanel
        title="Triage and investigation"
        description="Opinions from the AI model bound to each action, based only on the sanitized event summary. They never change the issue in Sentry."
      >
        <TriagePanel issue={issue} investigating={investigating} />
      </OpsPanel>

      <TechnicalDetails
        items={[
          { label: "Issue ID", value: issue.id },
          { label: "Sentry issue", value: issue.external_id },
          { label: "Project", value: issue.project_slug },
          { label: "Event", value: issue.digest_event_id },
          { label: "Digest hash", value: issue.digest_hash },
          { label: "Group key", value: issue.group_key },
        ]}
      />
    </div>
  );
}

function IssueDetail({ id }: { id: string }) {
  const detail = useApi<ErrorIssueDetail>(issueUrl(id));
  if (detail.data)
    return <IssueView issue={detail.data} onChanged={detail.refetch} />;
  if (detail.loading) return <LoadingState label="Loading issue" />;
  // useApi keeps only the response body, not the status or the error code.
  const notFound = /ERROR_ISSUE_NOT_FOUND|not found/i.test(detail.error ?? "");
  return notFound ? (
    <ErrorState
      variant="page"
      kind="notFound"
      title="Issue not in the inbox"
      message="It may have been resolved or ignored more than 30 days ago, when Crate forgets it."
      backTo="/errors"
      backLabel="Back to errors"
    />
  ) : (
    <ErrorState
      message="Could not load this issue."
      onRetry={detail.refetch}
      backTo="/errors"
      backLabel="Back to errors"
    />
  );
}

/** One Error Inbox issue: metrics, the sanitized event digest and actions. */
export function ErrorDetail() {
  const { id = "" } = useParams();
  return <IssueDetail key={id} id={id} />;
}
