import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { Button } from "@crate/ui/shadcn/button";
import { Card, CardContent } from "@crate/ui/shadcn/card";

import { PanelState } from "./PanelState";
import type { StreamingPeerStat } from "./types";
import { formatBytes } from "./types";

interface Ticket {
  ticket_uid: string;
  node_uid: string;
  subject_hash: string | null;
  expires_at: string;
}

export function StreamsPanel({ canManage }: { canManage: boolean }) {
  const stats = useApi<{ peers: StreamingPeerStat[] }>(
    "/api/admin/federation/streaming-stats",
  );
  const tickets = useApi<Ticket[]>("/api/admin/federation/streams");
  const revoke = async (ticketUid: string) => {
    try {
      await api(`/api/admin/federation/streams/${ticketUid}/revoke`, "POST");
      await tickets.refetch();
      toast.success("Stream ticket revoked");
    } catch {
      toast.error("Stream revocation failed");
    }
  };
  return (
    <PanelState
      loading={stats.loading || tickets.loading}
      error={stats.error || tickets.error}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {stats.data?.peers.map((peer) => (
            <Card key={peer.node_uid}>
              <CardContent className="p-4 text-sm">
                <p>{peer.display_name}</p>
                <p className="text-white/45">
                  {peer.active_streams} active · {formatBytes(peer.daily_bytes)}{" "}
                  today
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
        {(tickets.data ?? []).length === 0 ? (
          <p className="text-sm text-white/45">No active stream tickets.</p>
        ) : (
          tickets.data?.map((ticket) => (
            <Card key={ticket.ticket_uid}>
              <CardContent className="flex items-center justify-between p-3">
                <span className="font-mono text-xs">{ticket.ticket_uid}</span>
                {canManage ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void revoke(ticket.ticket_uid)}
                  >
                    Revoke
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </PanelState>
  );
}
