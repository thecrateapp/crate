import { useApi } from "@/hooks/use-api";
import { OpsPanel } from "@/components/admin/ops-surfaces";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { StatNumber } from "@crate/ui/primitives/StatNumber";

import { PanelState } from "./PanelState";
import type { FederationStatus, StreamingPeerStat } from "./types";
import { formatBytes } from "./types";

export function FederationOverview() {
  const status = useApi<FederationStatus>("/api/admin/federation/status");
  const streams = useApi<{ peers: StreamingPeerStat[] }>(
    "/api/admin/federation/streaming-stats",
  );
  const peers = streams.data?.peers ?? [];

  return (
    <PanelState loading={status.loading} error={status.error}>
      {status.data ? (
        <div className="min-w-0 space-y-7">
          <OpsPanel
            title="Node identity"
            description="Identity advertised to trusted Crate nodes."
          >
            <dl className="grid min-w-0 gap-5 sm:grid-cols-2">
              <div className="min-w-0">
                <dt>
                  <MonoLabel as="span">DISPLAY NAME</MonoLabel>
                </dt>
                <dd className="mt-2 break-words text-base font-medium text-text-primary">
                  {status.data.local_node?.display_name ?? "Unconfigured node"}
                </dd>
              </div>
              <div className="min-w-0">
                <dt>
                  <MonoLabel as="span">NODE UID</MonoLabel>
                </dt>
                <dd className="mt-2 break-all font-mono text-sm text-text-muted">
                  {status.data.local_node?.node_uid ?? "No node UID"}
                </dd>
              </div>
              <div className="min-w-0 sm:col-span-2">
                <dt>
                  <MonoLabel as="span">API BASE URL</MonoLabel>
                </dt>
                <dd className="mt-2 break-all font-mono text-sm text-text-muted">
                  {status.data.local_node?.api_base_url ?? "Not configured"}
                </dd>
              </div>
            </dl>
          </OpsPanel>

          <div className="grid min-w-0 gap-7 xl:grid-cols-2">
            <OpsPanel title="Trust" description="Peer access on this node.">
              <div className="flex flex-wrap gap-x-12 gap-y-5">
                <StatNumber
                  value={status.data.approved_peer_count}
                  label="APPROVED PEERS"
                />
                <StatNumber
                  value={status.data.pending_pairing_count}
                  label="PENDING PAIRINGS"
                />
              </div>
            </OpsPanel>

            <OpsPanel
              title="Streaming"
              description="Recent usage reported by each peer."
            >
              {streams.loading ? (
                <p className="text-sm text-text-muted" role="status">
                  Loading streaming usage…
                </p>
              ) : streams.error ? (
                <p className="text-sm text-state-warning-text" role="status">
                  Streaming usage is unavailable.
                </p>
              ) : peers.length === 0 ? (
                <p className="text-sm text-text-muted">No active peer usage.</p>
              ) : (
                <div className="divide-y divide-border-quiet">
                  {peers.map((peer) => (
                    <div
                      key={peer.node_uid}
                      className="grid min-w-0 gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text-primary">
                          {peer.display_name}
                        </p>
                        <p className="mt-1 font-mono text-xs text-text-subtle">
                          {peer.preset}
                        </p>
                      </div>
                      <StatNumber
                        value={peer.active_streams}
                        label="ACTIVE"
                        size="sm"
                      />
                      <StatNumber
                        value={formatBytes(peer.daily_bytes)}
                        label="TODAY"
                        size="sm"
                      />
                    </div>
                  ))}
                </div>
              )}
            </OpsPanel>
          </div>
        </div>
      ) : null}
    </PanelState>
  );
}
