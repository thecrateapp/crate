import { Globe, KeyRound, Radio } from "lucide-react";

import { useApi } from "@/hooks/use-api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@crate/ui/shadcn/card";

import { PanelState } from "./PanelState";
import type { FederationStatus, StreamingPeerStat } from "./types";
import { formatBytes } from "./types";

export function FederationOverview() {
  const status = useApi<FederationStatus>("/api/admin/federation/status");
  const streams = useApi<{ peers: StreamingPeerStat[] }>(
    "/api/admin/federation/streaming-stats",
  );
  return (
    <PanelState loading={status.loading} error={status.error}>
      {status.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Globe className="h-4 w-4" /> Node identity
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                {status.data.local_node?.display_name ?? "Unconfigured node"}
              </p>
              <p className="break-all font-mono text-xs text-white/45">
                {status.data.local_node?.node_uid ?? "No node UID"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <KeyRound className="h-4 w-4" /> Trust
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{status.data.approved_peer_count} approved peers</p>
              <p className="text-amber-300">
                {status.data.pending_pairing_count} pending pairings
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Radio className="h-4 w-4" /> Streaming
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {(streams.data?.peers ?? []).length === 0 ? (
                <p className="text-white/45">No active peer usage.</p>
              ) : (
                streams.data?.peers.map((peer) => (
                  <p key={peer.node_uid}>
                    {peer.display_name}: {peer.active_streams} active,{" "}
                    {formatBytes(peer.daily_bytes)} today
                  </p>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </PanelState>
  );
}
