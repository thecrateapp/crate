import { useContext } from "react";
import { Link } from "react-router";

import { Button } from "@crate/ui/shadcn/button";

import { OpsPanel, OpsStatTile } from "@/components/admin/ops-surfaces";
import { RelativeTime } from "@/components/admin/RelativeTime";
import { StatusBadge, type StatusTone } from "@/components/admin/StatusBadge";
import { AuthContext } from "@/contexts/AuthContext";
import {
  ERRORS_VIEW,
  formatCount,
  issuePath,
  problemText,
  type ErrorSummary,
} from "@/lib/error-inbox";

function tileState(errors: ErrorSummary | null | undefined): {
  label: string;
  tone: StatusTone;
} {
  if (!errors) return { label: "Unavailable", tone: "warning" };
  if (!errors.configured) return { label: "Not configured", tone: "neutral" };
  if (errors.sync?.status === "failed")
    return { label: "Sync failed", tone: "warning" };
  if (!errors.sync) return { label: "Waiting for sync", tone: "neutral" };
  return { label: "Synced", tone: "success" };
}

/**
 * Error Inbox summary on System Health, from the dashboard's `errors` field:
 * open, critical, new and regressed in 24 h and the top of the critical lane.
 * `null` or a missing field means the summary could not be built.
 */
export function ErrorsTile({
  errors,
}: {
  errors: ErrorSummary | null | undefined;
}) {
  // System Health is open to ops.health.view; the inbox needs its own capability.
  const canOpen =
    useContext(AuthContext)?.hasAnyCapability(ERRORS_VIEW) ?? false;
  const state = tileState(errors);
  return (
    <OpsPanel
      title="Errors"
      description="Sentry issues synced by Crate every 5 minutes, ordered by Crate priority."
      action={
        <>
          <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
          {canOpen ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/errors">Open errors</Link>
            </Button>
          ) : null}
        </>
      }
    >
      {!errors ? (
        <p className="text-sm text-text-muted">
          The error summary is unavailable in this sample.
        </p>
      ) : !errors.configured ? (
        <p className="text-sm text-text-muted">
          Error tracking is not set up. Connect Sentry from the Errors page to
          see issues here.
        </p>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <OpsStatTile
              label="Open"
              value={formatCount(errors.open)}
              caption={
                errors.last_synced_at ? (
                  <>
                    Synced <RelativeTime value={errors.last_synced_at} />
                  </>
                ) : (
                  "Not synced yet"
                )
              }
            />
            <OpsStatTile
              label="Critical"
              value={formatCount(errors.critical_open)}
              caption="Score 70 or more"
              tone={errors.critical_open > 0 ? "warning" : "default"}
            />
            <OpsStatTile
              label="New 24h"
              value={formatCount(errors.new_24h)}
              caption="First seen in the last day"
            />
            <OpsStatTile
              label="Regressions 24h"
              value={formatCount(errors.regressed_24h)}
              caption="Came back after being resolved"
              tone={errors.regressed_24h > 0 ? "warning" : "default"}
            />
          </div>
          {errors.sync?.status === "failed" ? (
            <p role="alert" className="text-sm text-state-warning-text">
              {problemText(errors.sync.error_code)}
            </p>
          ) : null}
          {errors.top_critical.length > 0 ? (
            <ol
              aria-label="Top of the critical lane"
              className="list-none border-t border-border-quiet p-0"
            >
              {errors.top_critical.slice(0, 3).map((issue) => (
                <li
                  key={issue.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 border-b border-border-quiet py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)_8rem_3rem]"
                >
                  <span className="font-mono text-label text-text-muted">
                    {issue.short_id}
                  </span>
                  {canOpen ? (
                    <Link
                      to={issuePath(issue.id)}
                      className="col-span-2 min-w-0 truncate text-sm text-text-primary hover:text-accent-action-hi sm:col-span-1"
                    >
                      {issue.title}
                    </Link>
                  ) : (
                    <span className="col-span-2 min-w-0 truncate text-sm text-text-primary sm:col-span-1">
                      {issue.title ?? (
                        <span className="text-text-muted" aria-hidden="true">
                          —
                        </span>
                      )}
                    </span>
                  )}
                  <span className="font-mono text-label text-text-muted">
                    {issue.service}
                  </span>
                  <span className="text-right font-mono text-label tabular-nums text-state-warning-text">
                    {issue.crate_score}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-text-muted">
              Nothing in the critical lane.
            </p>
          )}
        </div>
      )}
    </OpsPanel>
  );
}
