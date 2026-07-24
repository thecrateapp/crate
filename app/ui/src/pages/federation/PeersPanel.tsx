import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { Badge } from "@crate/ui/shadcn/badge";
import { Button } from "@crate/ui/shadcn/button";
import { Card, CardContent } from "@crate/ui/shadcn/card";

import { DirectoriesPanel } from "./DirectoriesPanel";
import { PairingPanel } from "./PairingPanel";
import { PanelState } from "./PanelState";
import type { FederationStatus } from "./types";

export function PeersPanel({ canManage }: { canManage: boolean }) {
  const status = useApi<FederationStatus>("/api/admin/federation/status");
  const mutate = async (path: string, message: string) => {
    try {
      await api(path, "POST");
      await status.refetch();
      toast.success(message);
    } catch {
      toast.error("Peer operation failed");
    }
  };
  return (
    <PanelState loading={status.loading} error={status.error}>
      <div className="space-y-6">
        <PairingPanel
          canManage={canManage}
          onChanged={() => void status.refetch()}
        />
        <DirectoriesPanel canManage={canManage} />
        <div className="space-y-3">
          {(status.data?.peers ?? []).length === 0 ? (
            <p className="text-sm text-white/45">No peers configured.</p>
          ) : (
            status.data?.peers.map((peer) => (
              <Card key={peer.node_uid}>
                <CardContent className="flex items-center justify-between gap-4 p-4">
                  <div>
                    <p className="flex items-center gap-2 font-medium">
                      {peer.display_name}
                      <Badge variant="secondary">{peer.trust_state}</Badge>
                    </p>
                    <p className="font-mono text-xs text-white/45">
                      {peer.node_uid}
                    </p>
                  </div>
                  {canManage ? (
                    <div className="flex gap-2">
                      {peer.trust_state === "pending" ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            void mutate(
                              `/api/admin/federation/pairing/${peer.node_uid}/approve`,
                              "Pairing approved",
                            )
                          }
                        >
                          Approve
                        </Button>
                      ) : null}
                      {peer.trust_state === "approved" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            void mutate(
                              `/api/admin/federation/nodes/${peer.node_uid}/sync-catalog`,
                              "Sync queued",
                            )
                          }
                        >
                          Sync
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          void mutate(
                            `/api/admin/federation/nodes/${peer.node_uid}/disable`,
                            "Peer disabled",
                          )
                        }
                      >
                        Disable
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>
    </PanelState>
  );
}
