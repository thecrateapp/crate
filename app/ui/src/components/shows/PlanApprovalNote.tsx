import { ExternalLink } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { approvalNextStep } from "./show-import-presentation";

const NOTE_TEXT = {
  change:
    "This change needs approval. Approve it in Agent approvals, then save it here.",
  merge:
    "A merge always needs approval. Approve it in Agent approvals, then come back and merge.",
} as const;

const LEAD_TEXT = {
  change: "This change needs approval.",
  merge: "A merge always needs approval.",
} as const;

const ACTION = { change: "save", merge: "merge" } as const;

export function PlanApprovalNote({
  planId,
  subject,
}: {
  planId: string;
  subject: "change" | "merge";
}) {
  const { hasCapability } = useAuth();
  // Agent approvals is gated by this capability; without it the link only
  // leads to «Permission required», so the note says who has to approve.
  const canApprove = hasCapability("agents.plans.review");
  return (
    <div
      role="note"
      className="space-y-1.5 rounded-md border border-state-warning/25 bg-state-warning/5 p-3 text-sm"
    >
      <p>
        {canApprove
          ? NOTE_TEXT[subject]
          : `${LEAD_TEXT[subject]} ${approvalNextStep(ACTION[subject], false)}`}
      </p>
      {canApprove ? (
        <a
          href={`/agents/approvals/${encodeURIComponent(planId)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2"
        >
          Open in Agent approvals
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </a>
      ) : null}
    </div>
  );
}
