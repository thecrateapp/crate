import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@crate/ui/shadcn/button";

import { useAuth } from "@/contexts/AuthContext";
import { useActionLLMStatus } from "@/hooks/use-llm";
import { api } from "@/lib/api";
import {
  ERRORS_MANAGE,
  TRIAGE_ACTION,
  TRIAGE_BACKLOG_LIMIT,
  TRIAGE_BACKLOG_URL,
  aiProblemText,
  apiErrorCode,
  formatCount,
  type TriageBacklogResult,
} from "@/lib/error-inbox";

function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

function queuedText(result: TriageBacklogResult): string {
  if (result.queued === 0)
    return "Every issue in the backlog is already queued for triage.";
  const already =
    result.deduplicated > 0
      ? ` ${plural(result.deduplicated, "was", "were")} already queued.`
      : "";
  return `Queued ${plural(result.queued, "issue", "issues")} for AI triage. Results appear in the list as each one finishes.${already}`;
}

/**
 * Triage backlog (E2): queues one AI triage per open issue whose latest event
 * has none, highest score first, at most 100 per press. The button names how
 * many it will queue. Each issue is its own task on the AI lane, so results
 * arrive one by one; the page refreshes the counts after queuing.
 */
export function TriageBacklog({
  untriaged,
  onQueued,
}: {
  untriaged: number;
  onQueued: () => void;
}) {
  const { hasCapability } = useAuth();
  const model = useActionLLMStatus(TRIAGE_ACTION);
  const [sending, setSending] = useState(false);
  if (!hasCapability(ERRORS_MANAGE) || untriaged <= 0) return null;
  const count = Math.min(untriaged, TRIAGE_BACKLOG_LIMIT);
  const unavailable = model !== null && !model.available;

  async function queue() {
    setSending(true);
    try {
      const result = await api<TriageBacklogResult>(TRIAGE_BACKLOG_URL, "POST");
      toast.success(queuedText(result));
      onQueued();
    } catch (caught) {
      toast.error(aiProblemText(apiErrorCode(caught), "triage"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={sending || model?.available !== true}
        aria-busy={sending || undefined}
        onClick={() => void queue()}
      >
        {sending ? "Queuing…" : `Triage backlog (${formatCount(count)})`}
      </Button>
      <p role="status" className="text-sm text-text-muted">
        {unavailable
          ? "No usable model is bound to Triage error issue. Bind one in AI models to triage the backlog."
          : untriaged > TRIAGE_BACKLOG_LIMIT
            ? `${formatCount(untriaged)} open issues have no AI triage of their latest event. Each press queues the ${TRIAGE_BACKLOG_LIMIT} with the highest score.`
            : `${plural(untriaged, "open issue has", "open issues have")} no AI triage of the latest event.`}
      </p>
    </div>
  );
}
