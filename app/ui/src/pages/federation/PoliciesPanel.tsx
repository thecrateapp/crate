import { useState } from "react";
import { toast } from "sonner";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { Button } from "@crate/ui/shadcn/button";
import { Card, CardContent } from "@crate/ui/shadcn/card";
import { Input } from "@crate/ui/shadcn/input";
import { FormField } from "@crate/ui/primitives/FormField";
import { AdminSelect } from "@/components/ui/AdminSelect";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";

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
        <MonoLabel as="p" size="eyebrow" className="break-all">
          {nodeUid}
        </MonoLabel>
        <FormField label="Grant preset">
          <AdminSelect
            value={preset}
            disabled={!canManage}
            allowClear={false}
            placeholder="Choose a preset"
            options={PRESETS.map((value) => ({
              value,
              label: value.replace(/_/g, " "),
            }))}
            onChange={(value) =>
              void patch(`/api/admin/federation/nodes/${nodeUid}/preset`, {
                preset: value,
              })
            }
          />
        </FormField>
        <div className="grid gap-2 sm:grid-cols-4">
          <FormField label="Maximum streams">
            <Input
              type="number"
              value={maxStreams}
              onChange={(event) => setMaxStreams(event.target.value)}
              placeholder="Max streams"
            />
          </FormField>
          <FormField label="Daily bytes">
            <Input
              type="number"
              value={dailyBytes}
              onChange={(event) => setDailyBytes(event.target.value)}
              placeholder="Daily bytes"
            />
          </FormField>
          <FormField label="Maximum results">
            <Input
              type="number"
              value={maxResults}
              onChange={(event) => setMaxResults(event.target.value)}
              placeholder="Max results"
            />
          </FormField>
          <Button
            className="self-end"
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
          <p className="text-sm text-text-muted">No approved peers.</p>
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
