import type { ReactNode } from "react";
import { Link } from "react-router";

import { EmptyState } from "@crate/ui/domain/lists/EmptyState";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

import { RelativeTime } from "@/components/admin/RelativeTime";
import {
  CLASSIFICATION_LABEL,
  currentAssessments,
  issuePath,
  previousAssessment,
  type DigestFrame,
  type ErrorIssueDetail,
  type ErrorTriage,
} from "@/lib/error-inbox";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-t border-border-quiet pt-2.5">
      <dt>
        <MonoLabel as="span">{label}</MonoLabel>
      </dt>
      <dd className="mt-1 text-sm text-text-secondary wrap-anywhere">
        {children}
      </dd>
    </div>
  );
}

function frameName(frame: DigestFrame | undefined, index: number): string {
  if (!frame) return `Frame ${index}`;
  const file = frame.filename ?? frame.module ?? "unknown file";
  const where = frame.lineno != null ? `${file}:${frame.lineno}` : file;
  return `${frame.function ?? "anonymous"} · ${where}`;
}

function Badges({ entry }: { entry: ErrorTriage }) {
  return (
    <div className="flex flex-wrap gap-2">
      {entry.classification ? (
        <InfoBadge>{CLASSIFICATION_LABEL[entry.classification]}</InfoBadge>
      ) : null}
      {entry.severity ? (
        <InfoBadge tone={entry.severity === "critical" ? "warning" : "neutral"}>
          {entry.severity}
        </InfoBadge>
      ) : null}
      <InfoBadge>{Math.round(entry.confidence * 100)}% confidence</InfoBadge>
    </div>
  );
}

/** One validated assessment: the closed fields the model returned, as stored. */
function Assessment({
  entry,
  title,
  frames,
}: {
  entry: ErrorTriage;
  title: string;
  frames: DigestFrame[];
}) {
  return (
    <section
      aria-label={title}
      className="space-y-3 border-t border-border-quiet pt-4 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <MonoLabel as="h3" tone="accent">
          {title}
        </MonoLabel>
        <Badges entry={entry} />
      </div>
      <p className="text-sm text-text-primary">{entry.summary}</p>
      <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2">
        {entry.hypothesis ? (
          <Row label="Hypothesis">{entry.hypothesis}</Row>
        ) : null}
        {entry.next_step ? (
          <Row label="Next step">{entry.next_step}</Row>
        ) : null}
        {entry.suspected_frames.length > 0 ? (
          <Row label="Suspected frames">
            <ul className="list-none space-y-1 p-0 font-mono text-label">
              {entry.suspected_frames.map((index) => (
                <li key={index}>{frameName(frames[index], index)}</li>
              ))}
            </ul>
          </Row>
        ) : null}
        {entry.duplicate_of ? (
          <Row label="Duplicate of">
            <Link
              to={issuePath(entry.duplicate_of)}
              className="text-text-secondary underline underline-offset-4 hover:text-text-primary"
            >
              Open the issue it duplicates
            </Link>
          </Row>
        ) : null}
      </dl>
      <p className="font-mono text-label text-text-muted">
        {entry.model ?? "Model no longer recorded"} ·{" "}
        <RelativeTime value={entry.created_at} />
      </p>
    </section>
  );
}

function Waiting({ issue }: { issue: ErrorIssueDetail }) {
  const earlier = previousAssessment(issue);
  const queued = issue.auto_triage_queued_at;
  return (
    <div className="space-y-3">
      <EmptyState
        title="No AI triage of the latest event"
        description={
          queued
            ? "Automatic triage queued this event. Its result appears here when the model answers; if it failed, Investigate or Triage backlog tries again."
            : "The Crate score orders this issue in the meantime. Investigate it here, or triage the backlog from the Errors page."
        }
      />
      {queued ? (
        <p className="font-mono text-label text-text-muted">
          Queued <RelativeTime value={queued} />
        </p>
      ) : null}
      {earlier ? (
        <p className="text-sm text-text-muted">
          An earlier event was assessed as{" "}
          {earlier.classification
            ? CLASSIFICATION_LABEL[earlier.classification].toLowerCase()
            : "unclassified"}
          {earlier.severity ? `, ${earlier.severity} severity` : ""}:{" "}
          {earlier.summary}
        </p>
      ) : null}
    </div>
  );
}

/**
 * AI triage and investigation of the issue's current event: classification,
 * severity, hypothesis, suspected frames, next step, the model and when. Both
 * are opinions from a model fed the sanitized digest; nothing here changes the
 * issue in Sentry.
 */
export function TriagePanel({
  issue,
  investigating = false,
}: {
  issue: ErrorIssueDetail;
  investigating?: boolean;
}) {
  const { triage, investigation } = currentAssessments(issue);
  const frames = issue.digest?.frames ?? [];
  return (
    <div className="space-y-4">
      {investigating ? (
        <p role="status" className="text-sm text-text-muted">
          Investigating the latest event. The result appears here when the model
          answers.
        </p>
      ) : null}
      {triage || investigation ? (
        <div className="space-y-4">
          {investigation ? (
            <Assessment
              entry={investigation}
              title="Investigation"
              frames={frames}
            />
          ) : null}
          {triage ? (
            <Assessment entry={triage} title="Triage" frames={frames} />
          ) : null}
        </div>
      ) : (
        <Waiting issue={issue} />
      )}
    </div>
  );
}

/** Frame indexes the current assessments point at, investigation first. */
export function suspectedFrames(issue: ErrorIssueDetail): number[] {
  const { triage, investigation } = currentAssessments(issue);
  return [
    ...new Set([
      ...(investigation?.suspected_frames ?? []),
      ...(triage?.suspected_frames ?? []),
    ]),
  ];
}
