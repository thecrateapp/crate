import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { Button } from "@crate/ui/shadcn/button";
import { Card, CardContent } from "@crate/ui/shadcn/card";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

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
  const peers = stats.data?.peers ?? [];
  const activeTickets = tickets.data ?? [];
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
        {peers.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {peers.map((peer) => (
              <Card key={peer.node_uid}>
                <CardContent className="p-4 text-sm">
                  <p className="font-display font-medium text-text-primary">
                    {peer.display_name}
                  </p>
                  <p className="text-text-muted">
                    {peer.active_streams} active ·{" "}
                    {formatBytes(peer.daily_bytes)} today
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}
        {activeTickets.length === 0 ? (
          <p className="text-sm text-text-muted">No active stream tickets.</p>
        ) : (
          activeTickets.map((ticket) => (
            <Card key={ticket.ticket_uid}>
              <CardContent className="flex items-center justify-between p-3">
                <MonoLabel as="span" size="eyebrow" className="break-all">
                  {ticket.ticket_uid}
                </MonoLabel>
                {canManage ? (
                  <Button
                    size="sm"
                    variant="outline"
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
