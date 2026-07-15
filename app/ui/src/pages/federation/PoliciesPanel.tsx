import { useState } from "react";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { Button } from "@crate/ui/shadcn/button";
import { Card, CardContent } from "@crate/ui/shadcn/card";
import { Input } from "@crate/ui/shadcn/input";

import { PanelState } from "./PanelState";
import type { FederationStatus } from "./types";

const PRESETS = ["off", "discovery", "catalog", "listen", "trusted_library"];

function PeerPolicy({
  nodeUid,
  preset,
  canManage,
  onChanged,
}: {
  nodeUid: string;
  preset: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [maxStreams, setMaxStreams] = useState("");
  const [dailyBytes, setDailyBytes] = useState("");
  const [maxResults, setMaxResults] = useState("");
  const patch = async (path: string, body: object) => {
    try {
      await api(path, "PATCH", body);
      onChanged();
      toast.success("Policy updated");
    } catch {
      toast.error("Policy update failed");
    }
  };
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <p className="font-mono text-xs text-white/45">{nodeUid}</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((value) => (
            <Button
              key={value}
              size="sm"
              variant={preset === value ? "default" : "secondary"}
              disabled={!canManage}
              onClick={() =>
                void patch(`/api/admin/federation/nodes/${nodeUid}/preset`, {
                  preset: value,
                })
              }
            >
              {value}
            </Button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-4">
          <Input
            aria-label="Maximum streams"
            type="number"
            value={maxStreams}
            onChange={(event) => setMaxStreams(event.target.value)}
            placeholder="Max streams"
          />
          <Input
            aria-label="Daily bytes"
            type="number"
            value={dailyBytes}
            onChange={(event) => setDailyBytes(event.target.value)}
            placeholder="Daily bytes"
          />
          <Input
            aria-label="Maximum results"
            type="number"
            value={maxResults}
            onChange={(event) => setMaxResults(event.target.value)}
            placeholder="Max results"
          />
          <Button
            disabled={!canManage}
            onClick={() =>
              void patch(`/api/admin/federation/nodes/${nodeUid}/limits`, {
                max_streams: maxStreams ? Number(maxStreams) : null,
                daily_bytes: dailyBytes ? Number(dailyBytes) : null,
                max_results: maxResults ? Number(maxResults) : null,
              })
            }
          >
            Apply limits
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PoliciesPanel({ canManage }: { canManage: boolean }) {
  const status = useApi<FederationStatus>("/api/admin/federation/status");
  const peers = (status.data?.peers ?? []).filter(
    (peer) => peer.trust_state === "approved",
  );
  return (
    <PanelState loading={status.loading} error={status.error}>
      <div className="space-y-3">
        {peers.length === 0 ? (
          <p className="text-sm text-white/45">No approved peers.</p>
        ) : (
          peers.map((peer) => (
            <PeerPolicy
              key={peer.node_uid}
              nodeUid={peer.node_uid}
              preset={peer.default_grant_preset}
              canManage={canManage}
              onChanged={() => void status.refetch()}
            />
          ))
        )}
      </div>
    </PanelState>
  );
}
