import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Button } from "@crate/ui/shadcn/button";
import { Card, CardContent } from "@crate/ui/shadcn/card";

import { DirectoriesPanel } from "./DirectoriesPanel";
import { PairingPanel } from "./PairingPanel";
import { PanelState } from "./PanelState";
import type { FederationStatus } from "./types";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";

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
            <EmptyState title="No peers configured" />
          ) : (
            status.data?.peers.map((peer) => (
              <Card key={peer.node_uid}>
                <CardContent className="flex items-center justify-between gap-4 p-4">
                  <div>
                    <p className="flex items-center gap-2 font-medium">
                      {peer.display_name}
                      <InfoBadge
                        tone={
                          peer.trust_state === "approved"
                            ? "success"
                            : peer.trust_state === "pending"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {peer.trust_state}
                      </InfoBadge>
                    </p>
                    <p className="font-mono text-xs text-text-muted">
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
                        variant="outline"
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
