import { useApi } from "@/hooks/use-api";
import { Badge } from "@crate/ui/shadcn/badge";

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
          <p className="text-sm text-white/45">No audit events.</p>
        ) : (
          audit.data?.map((event) => (
            <div
              key={event.id}
              className="flex items-center gap-3 rounded-md border border-white/5 px-3 py-2 text-xs"
            >
              <Badge variant="secondary">{event.status}</Badge>
              <span>{event.event_type}</span>
              <time
                className="ml-auto text-white/45"
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
