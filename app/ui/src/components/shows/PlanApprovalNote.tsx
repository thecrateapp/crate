import { ExternalLink } from "lucide-react";

const NOTE_TEXT = {
  change:
    "This change needs approval. Approve it in Agent approvals, then save it here.",
  merge:
    "A merge always needs approval. Approve it in Agent approvals, then come back and merge.",
} as const;

export function PlanApprovalNote({
  planId,
  subject,
}: {
  planId: string;
  subject: "change" | "merge";
}) {
  return (
    <div
      role="note"
      className="space-y-1.5 rounded-md border border-state-warning/25 bg-state-warning/5 p-3 text-sm"
    >
      <p>{NOTE_TEXT[subject]}</p>
      <a
        href={`/agents/approvals/${encodeURIComponent(planId)}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2"
      >
        Open in Agent approvals
        <ExternalLink aria-hidden="true" className="size-3.5" />
      </a>
    </div>
  );
}
