import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/agent-plan-presentation";
import { InfoBadge } from "@crate/ui/primitives/InfoBadge";
import { Button } from "@crate/ui/shadcn/button";
import { Card, CardContent } from "@crate/ui/shadcn/card";

import { DirectoriesPanel } from "./DirectoriesPanel";
import { PairingPanel } from "./PairingPanel";
import { PanelState } from "./PanelState";
import type { FederationPairing, FederationStatus } from "./types";
import { EmptyState } from "@crate/ui/domain/lists/EmptyState";

const activePairingStates = new Set([
  "created",
  "offered",
  "remote_pending",
  "accepted",
]);

export function PeersPanel({ canManage }: { canManage: boolean }) {
  const status = useApi<FederationStatus>("/api/admin/federation/status");
  const [now, setNow] = useState(Date.now);

  // Requests expire even when no new status response causes a render.
  const nextExpiry = Math.min(
    ...(status.data?.pairings ?? [])
      .filter((pairing) => activePairingStates.has(pairing.state))
      .map((pairing) => Date.parse(pairing.expires_at))
      .filter((expiry) => Number.isFinite(expiry) && expiry > now),
  );
  useEffect(() => {
    if (!Number.isFinite(nextExpiry)) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(2_147_483_647, Math.max(0, nextExpiry - Date.now())),
    );
    return () => window.clearTimeout(timer);
  }, [nextExpiry, now]);

  const mutate = async (path: string, message: string) => {
    try {
      await api(path, "POST");
      await status.refetch();
      toast.success(message);
    } catch (error) {
      // A failed callback may have persisted an acceptance that can be resumed.
      await status.refetch();
      toast.error(apiErrorText(error, "Peer operation failed"));
    }
  };
  const approve = (pairing: FederationPairing) => {
    if (Date.parse(pairing.expires_at) <= Date.now()) {
      setNow(Date.now());
      toast.error("Pairing request expired. Start a new request.");
      return;
    }
    void mutate(
      `/api/admin/federation/pairing/${encodeURIComponent(pairing.pairing_uid)}/approve`,
      "Pairing approved",
    );
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
            status.data?.peers.map((peer) => {
              // The API orders requests by creation time. Never revive an older
              // inbound request when a newer outbound or terminal request exists.
              const pairing = status.data?.pairings?.find(
                (request) => request.remote_node_uid === peer.node_uid,
              );
              const unresolved =
                pairing && activePairingStates.has(pairing.state);
              const expiry = pairing ? Date.parse(pairing.expires_at) : NaN;
              const expired =
                pairing?.state === "expired" ||
                (unresolved && Number.isFinite(expiry) && expiry <= now);
              const canApprove =
                !peer.disabled_at &&
                pairing?.direction === "inbound" &&
                ["remote_pending", "accepted"].includes(pairing.state) &&
                Number.isFinite(expiry) &&
                expiry > now;
              const notice = peer.disabled_at
                ? "Peer is disabled."
                : expired
                  ? "Pairing request expired. Start a new request."
                  : unresolved && pairing.direction === "outbound"
                    ? `Awaiting approval from ${peer.display_name}.`
                    : peer.trust_state === "pending" && !canApprove
                      ? "No pending pairing request is available. Start a new request."
                      : null;
              return (
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
                      {notice ? (
                        <p className="mt-2 text-xs text-text-muted">{notice}</p>
                      ) : null}
                    </div>
                    {canManage ? (
                      <div className="flex gap-2">
                        {canApprove && pairing ? (
                          <Button size="sm" onClick={() => approve(pairing)}>
                            {pairing.state === "accepted"
                              ? "Retry approval"
                              : "Approve"}
                          </Button>
                        ) : null}
                        {peer.trust_state === "approved" &&
                        !peer.disabled_at ? (
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
              );
            })
          )}
        </div>
      </div>
    </PanelState>
  );
}
