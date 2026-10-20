import { Button } from "@crate/ui/shadcn/button";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { StructuredValue } from "@/components/admin/StructuredValue";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import { PlanApprovalNote } from "./PlanApprovalNote";
import {
  SHOW_STATUS_LABELS,
  countLabel,
  issueText,
  planChangeView,
  showLinkPath,
  type PlanChangeView,
} from "./show-import-presentation";
import type {
  ShowCandidate,
  ShowImportPlan,
  ShowPlanIssue,
} from "./show-import-types";

function fieldValue(key: string, value: unknown): unknown {
  return key === "status" && typeof value === "string"
    ? (SHOW_STATUS_LABELS[value] ?? value)
    : value;
}

function FieldRows({ view }: { view: PlanChangeView }) {
  // «Already in Crate · no changes» says it all; no field list is needed.
  if (view.unchangedUpdate || (!view.fields.length && !view.unchanged))
    return null;
  return (
    <div className="space-y-1">
      <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(7rem,auto)_1fr]">
        {view.fields.map((field) => (
          <div
            key={field.key}
            data-status={field.status}
            className={
              view.isUpdate
                ? "contents [&>*]:bg-state-warning/5 [&>*]:py-0.5"
                : "contents"
            }
          >
            <dt className="text-muted-foreground">{field.label}</dt>
            <dd className="min-w-0">
              {view.isUpdate ? (
                <span className="inline-flex flex-wrap items-baseline gap-1">
                  <span className="text-muted-foreground">
                    <StructuredValue
                      value={fieldValue(field.key, field.before)}
                    />
                  </span>
                  <span aria-hidden="true">→</span>
                  <span className="sr-only">changes to</span>
                  {field.status === "cleared" ? (
                    <span className="font-medium">Cleared</span>
                  ) : (
                    <span className="font-medium">
                      <StructuredValue
                        value={fieldValue(field.key, field.value)}
                      />
                    </span>
                  )}
                </span>
              ) : (
                <StructuredValue value={fieldValue(field.key, field.value)} />
              )}
            </dd>
          </div>
        ))}
      </dl>
      {view.isUpdate && view.unchanged > 0 ? (
        <p className="text-xs text-muted-foreground">
          {countLabel(view.unchanged, "unchanged field")}
        </p>
      ) : null}
    </div>
  );
}

function SourceLines({ view }: { view: PlanChangeView }) {
  if (!view.evidence && !view.source && !view.readBy) return null;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {view.evidence ? (
        <div>
          <p className="font-medium">From the source</p>
          <p className="line-clamp-3 whitespace-pre-wrap" title={view.evidence}>
            {view.evidence}
          </p>
        </div>
      ) : null}
      {view.source ? (
        view.source.href ? (
          <p>
            Source:{" "}
            <a
              href={view.source.href}
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline underline-offset-2"
            >
              {view.source.text}
            </a>
          </p>
        ) : (
          <p>Source: {view.source.text}</p>
        )
      ) : null}
      {view.readBy ? <p>Read by {view.readBy}</p> : null}
    </div>
  );
}

function IssueRow({
  issue,
  label,
  disabled,
  onUseExisting,
  onUseArtist,
}: {
  issue: ShowPlanIssue;
  label: string | null;
  disabled: boolean;
  onUseExisting: (itemId: string, showId: number) => void;
  onUseArtist: (
    itemId: string,
    artist: { artist_uid: string; name: string },
  ) => void;
}) {
  const matches = issue.matches ?? [];
  const artists = issue.artist_matches ?? [];
  // Several issues repeat the same visible text, so each accessible name
  // adds its row and, when needed, which match it is.
  const named = (text: string, detail?: string) => {
    const context = [detail, label].filter(Boolean).join(", ");
    return context ? `${text} (${context})` : text;
  };
  return (
    <li className="space-y-2 rounded-md border border-state-warning/25 bg-state-warning/5 p-3 text-sm">
      <p role="alert">{issueText(issue, label)}</p>
      {matches.length || artists.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {matches.map((showId, index) => (
            <span key={showId} className="inline-flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={named(
                  matches.length > 1
                    ? `Update existing show ${index + 1}`
                    : "Update the existing show",
                )}
                disabled={disabled}
                onClick={() => onUseExisting(issue.item_id, showId)}
              >
                {matches.length > 1
                  ? `Update existing show ${index + 1}`
                  : "Update the existing show"}
              </Button>
              <a
                href={showLinkPath(showId)}
                target="_blank"
                rel="noreferrer"
                aria-label={named(
                  "View it",
                  matches.length > 1 ? `existing show ${index + 1}` : undefined,
                )}
                className="text-foreground underline underline-offset-2"
              >
                View it
              </a>
            </span>
          ))}
          {artists.map((artist) => (
            <Button
              key={artist.artist_uid}
              type="button"
              variant="outline"
              size="sm"
              title={artist.artist_uid}
              aria-label={named(`Use ${artist.name}`)}
              disabled={disabled}
              onClick={() => onUseArtist(issue.item_id, artist)}
            >
              {`Use ${artist.name}`}
            </Button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function ShowPlanSummary({
  plan,
  candidates,
  disabled = false,
  onUseExisting,
  onUseArtist,
}: {
  plan: ShowImportPlan;
  candidates: ShowCandidate[];
  disabled?: boolean;
  onUseExisting: (itemId: string, showId: number) => void;
  onUseArtist: (
    itemId: string,
    artist: { artist_uid: string; name: string },
  ) => void;
}) {
  const position = new Map(
    candidates.map((candidate, index) => [candidate.item_id, index + 1]),
  );
  const rowLabel = (itemId: string) => {
    const k = position.get(itemId);
    return k ? `Show ${k}` : null;
  };
  const views = plan.changes.map((change, index) => ({
    itemId: change.item_id,
    view: planChangeView(
      change,
      rowLabel(change.item_id) ?? `Show ${index + 1}`,
    ),
  }));
  return (
    <section
      aria-label="Review before saving"
      className="space-y-4 rounded-md border border-border p-4"
    >
      <div className="space-y-0.5">
        <h3 className="text-sm font-medium">Review before saving</h3>
        <p className="text-xs text-muted-foreground">
          {`${countLabel(plan.changes.length, "show")} to save`}
        </p>
      </div>
      <ul className="space-y-3">
        {views.map(({ itemId, view }) => (
          <li
            key={itemId}
            className="space-y-3 rounded-md border border-border p-3"
          >
            <div className="flex flex-wrap items-start gap-2">
              <StatusBadge
                tone={
                  view.unchangedUpdate
                    ? "neutral"
                    : view.isUpdate
                      ? "warning"
                      : "info"
                }
              >
                {view.unchangedUpdate
                  ? "Already in Crate · no changes"
                  : view.isUpdate
                    ? "Update"
                    : "New"}
              </StatusBadge>
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-medium">{view.title}</h4>
                <p className="text-xs text-muted-foreground">{view.subtitle}</p>
              </div>
            </div>
            <FieldRows view={view} />
            <SourceLines view={view} />
          </li>
        ))}
      </ul>
      {plan.issues?.length ? (
        <ul className="space-y-2">
          {plan.issues.map((issue, index) => (
            <IssueRow
              key={`${issue.item_id}-${index}`}
              issue={issue}
              label={issue.item_id ? rowLabel(issue.item_id) : null}
              disabled={disabled}
              onUseExisting={onUseExisting}
              onUseArtist={onUseArtist}
            />
          ))}
        </ul>
      ) : null}
      {plan.approval_required ? (
        <PlanApprovalNote planId={plan.plan_id} subject="change" />
      ) : null}
      <TechnicalDetails
        items={[
          { label: "Plan ID", value: plan.plan_id },
          { label: "Plan version", value: plan.plan_version },
          ...views.flatMap(({ view }) => view.technical),
        ]}
      />
    </section>
  );
}
