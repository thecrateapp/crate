import { useApi } from "@/hooks/use-api";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";

import { PanelState } from "./PanelState";

interface AuditEvent {
  id: number;
  node_uid: string | null;
  event_type: string;
  status: string;
  created_at: string;
}

export function AuditPanel() {
  const audit = useApi<AuditEvent[]>("/api/admin/federation/audit?limit=100");
  return (
    <PanelState loading={audit.loading} error={audit.error}>
      <div className="space-y-1">
        {(audit.data ?? []).length === 0 ? (
          <p className="text-sm text-text-muted">No audit events.</p>
        ) : (
          audit.data?.map((event) => (
            <div
              key={event.id}
              className="flex items-center gap-3 rounded-md border border-border-quiet-subtle px-3 py-2 text-xs"
            >
              <InfoBadge
                tone={
                  event.status === "success"
                    ? "success"
                    : event.status === "failed"
                      ? "danger"
                      : "neutral"
                }
              >
                {event.status}
              </InfoBadge>
              <span>{event.event_type}</span>
              <time
                className="ml-auto text-text-muted"
                dateTime={event.created_at}
              >
                {new Date(event.created_at).toLocaleString()}
              </time>
            </div>
          ))
        )}
      </div>
    </PanelState>
  );
}
