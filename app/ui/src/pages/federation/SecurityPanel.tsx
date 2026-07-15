import { useState } from "react";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { Badge } from "@crate/ui/shadcn/badge";
import { Button } from "@crate/ui/shadcn/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@crate/ui/shadcn/card";

import { PanelState } from "./PanelState";
import type { FederationStatus } from "./types";

interface RiskDashboard {
  latest_snapshot: { score: number; algorithm_version: string } | null;
  observations: {
    id: number;
    observation_type: string;
    count: number;
    severity: string;
  }[];
  temporary_actions: {
    id: number;
    action_type: string;
    capability: string;
    reason_code: string;
    expires_at: string;
  }[];
}

export function SecurityPanel({ canManage }: { canManage: boolean }) {
  const status = useApi<FederationStatus>("/api/admin/federation/status");
  const [peerUid, setPeerUid] = useState<string | null>(null);
  const selected = peerUid ?? status.data?.peers[0]?.node_uid ?? null;
  const risk = useApi<RiskDashboard>(
    selected
      ? `/api/admin/federation/risk?node_uid=${encodeURIComponent(selected)}`
      : null,
  );
  const mutate = async (path: string, message: string) => {
    try {
      await api(path, "POST");
      await risk.refetch();
      toast.success(message);
    } catch {
      toast.error("Security operation failed");
    }
  };
  return (
    <PanelState loading={status.loading} error={status.error}>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Key material</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Active key:{" "}
              <span className="font-mono">
                {status.data?.local_node?.active_key_id ?? "unavailable"}
              </span>
            </p>
            {canManage && status.data?.local_node ? (
              <Button
                size="sm"
                onClick={() =>
                  void mutate(
                    `/api/admin/federation/nodes/${status.data?.local_node?.node_uid}/rotate-local-key`,
                    "Key rotation announced",
                  )
                }
              >
                Start key rotation
              </Button>
            ) : null}
          </CardContent>
        </Card>
        <div className="flex flex-wrap gap-2">
          {status.data?.peers.map((peer) => (
            <Button
              key={peer.node_uid}
              size="sm"
              variant={selected === peer.node_uid ? "default" : "secondary"}
              onClick={() => setPeerUid(peer.node_uid)}
            >
              {peer.display_name}
            </Button>
          ))}
        </div>
        {selected ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Risk explanation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p>
                Score: {risk.data?.latest_snapshot?.score ?? 0}{" "}
                <Badge variant="secondary">
                  {risk.data?.latest_snapshot?.algorithm_version ??
                    "not computed"}
                </Badge>
              </p>
              {risk.data?.observations.map((item) => (
                <p key={item.id} className="text-xs">
                  {item.observation_type}: {item.count} ({item.severity})
                </p>
              ))}
              {risk.data?.temporary_actions.map((action) => (
                <div
                  key={action.id}
                  className="flex items-center justify-between text-xs"
                >
                  <span>
                    {action.action_type} {action.capability} until{" "}
                    <time dateTime={action.expires_at}>
                      {new Date(action.expires_at).toLocaleString()}
                    </time>
                  </span>
                  {canManage ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        void mutate(
                          `/api/admin/federation/risk/actions/${action.id}/reverse`,
                          "Temporary action reversed",
                        )
                      }
                    >
                      Reverse
                    </Button>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-white/45">No peers to evaluate.</p>
        )}
      </div>
    </PanelState>
  );
}
