import { useState, useCallback } from "react";
import { useApi } from "@/hooks/use-api";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { toast } from "sonner";
import {
  Shield,
  Globe,
  Radio,
  UserX,
  Plus,
  XCircle,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@crate/ui/shadcn/badge";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@crate/ui/shadcn/card";

type Tab = "overview" | "peers" | "presets" | "subjects" | "audit";

interface LocalNode {
  node_uid: string;
  display_name: string;
  api_base_url: string | null;
  active_key_id: string;
}

interface Peer {
  node_uid: string;
  display_name: string;
  api_base_url: string;
  trust_state: string;
  default_grant_preset: string;
  health_json: Record<string, unknown>;
  last_health_at: string | null;
  disabled_at: string | null;
}

interface RemoteSubject {
  id: number;
  node_uid: string;
  subject_hash: string;
  last_seen_at: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  stats_json: Record<string, unknown>;
}

interface AuditEvent {
  id: number;
  node_uid: string | null;
  event_type: string;
  status: string;
  created_at: string;
}

interface FederationStatus {
  local_node: LocalNode | null;
  peer_count: number;
  approved_peer_count: number;
  pending_pairing_count: number;
  peers: Peer[];
}

interface StreamingPeerStat {
  node_uid: string;
  display_name: string;
  preset: string;
  active_streams: number;
  daily_bytes: number;
}

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "peers", label: "Peers" },
  { key: "presets", label: "Presets" },
  { key: "subjects", label: "Subjects" },
  { key: "audit", label: "Audit" },
];

const PRESETS = [
  "off",
  "discovery",
  "catalog",
  "listen",
  "trusted_library",
] as const;

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function Federation() {
  const { hasAnyCapability } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const [probeUrl, setProbeUrl] = useState("");
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [pairingUrl, setPairingUrl] = useState("");
  const [pairingResult, setPairingResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [directoryUrl, setDirectoryUrl] = useState("");
  const [directoryKeyId, setDirectoryKeyId] = useState("directory");
  const [directoryPublicKey, setDirectoryPublicKey] = useState("");
  const [importingDir, setImportingDir] = useState(false);
  const [directoryResult, setDirectoryResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [pairingRequests, setPairingRequests] = useState<
    Record<string, string>
  >({});

  const {
    data: status,
    loading,
    refetch,
  } = useApi<FederationStatus>("/api/admin/federation/status");
  const { data: audit } = useApi<AuditEvent[]>(
    "/api/admin/federation/audit?limit=50",
  );
  const { data: streamingStats } = useApi<{ peers: StreamingPeerStat[] }>(
    "/api/admin/federation/streaming-stats",
  );
  const [subjects, setSubjects] = useState<Record<string, RemoteSubject[]>>({});
  const [subjectsNode, setSubjectsNode] = useState<string | null>(null);

  const loadSubjects = useCallback(async (nodeUid: string) => {
    try {
      const data = await api<RemoteSubject[]>(
        `/api/admin/federation/nodes/${nodeUid}/subjects`,
      );
      setSubjects((prev) => ({ ...prev, [nodeUid]: data }));
      setSubjectsNode(nodeUid);
    } catch {
      toast.error("Failed to load subjects");
    }
  }, []);

  const handleProbe = async () => {
    setProbing(true);
    setProbeResult(null);
    try {
      const result = await api<Record<string, unknown>>(
        "/api/admin/federation/nodes/probe",
        "POST",
        { url: probeUrl },
      );
      setProbeResult(result);
      toast.success("Node probed successfully");
    } catch {
      toast.error("Failed to probe node");
    }
    setProbing(false);
  };

  const handlePair = async () => {
    try {
      const result = await api<Record<string, unknown>>(
        "/api/admin/federation/pairing/start",
        "POST",
        { url: pairingUrl },
      );
      setPairingResult(result);
      const pairing = (result as any)?.pairing;
      const peer = (result as any)?.peer;
      if (pairing?.request_uid && peer?.node_uid) {
        setPairingRequests((prev) => ({
          ...prev,
          [peer.node_uid]: pairing.request_uid,
        }));
      }
      toast.success("Pairing request created");
      refetch();
    } catch {
      toast.error("Failed to start pairing");
    }
  };

  const handleImportDirectory = async () => {
    setImportingDir(true);
    setDirectoryResult(null);
    try {
      const result = await api<Record<string, unknown>>(
        "/api/admin/federation/directory/import",
        "POST",
        {
          url: directoryUrl,
          trusted_key_id: directoryKeyId,
          trusted_public_key: directoryPublicKey,
        },
      );
      setDirectoryResult(result);
      toast.success("Directory imported");
      refetch();
    } catch {
      toast.error("Failed to import directory");
    }
    setImportingDir(false);
  };

  const handleApprovePairing = async (nodeUid: string) => {
    const requestUid = pairingRequests[nodeUid] || nodeUid;
    try {
      await api(`/api/admin/federation/pairing/${requestUid}/approve`, "POST");
      toast.success("Pairing approved");
      refetch();
    } catch {
      toast.error("Failed to approve pairing");
    }
  };

  const handleDisablePeer = async (nodeUid: string) => {
    try {
      await api(`/api/admin/federation/nodes/${nodeUid}/disable`, "POST");
      toast.success("Peer disabled");
      refetch();
    } catch {
      toast.error("Failed to disable peer");
    }
  };

  const handleSetPreset = async (nodeUid: string, preset: string) => {
    try {
      await api(`/api/admin/federation/nodes/${nodeUid}/preset`, "PATCH", {
        preset,
      });
      toast.success(`Preset set to ${preset}`);
      refetch();
    } catch {
      toast.error("Failed to update preset");
    }
  };

  const handleSyncCatalog = async (nodeUid: string) => {
    try {
      await api(`/api/admin/federation/nodes/${nodeUid}/sync-catalog`, "POST");
      toast.success("Catalog sync queued");
      refetch();
    } catch {
      toast.error("Failed to queue catalog sync");
    }
  };

  const handleBlockSubject = async (nodeUid: string, subjectHash: string) => {
    try {
      await api(
        `/api/admin/federation/nodes/${nodeUid}/subjects/${subjectHash}/block`,
        "POST",
      );
      toast.success("Subject blocked");
      loadSubjects(nodeUid);
    } catch {
      toast.error("Failed to block subject");
    }
  };

  const handleUnblockSubject = async (nodeUid: string, subjectHash: string) => {
    try {
      await api(
        `/api/admin/federation/nodes/${nodeUid}/subjects/${subjectHash}/unblock`,
        "POST",
      );
      toast.success("Subject unblocked");
      loadSubjects(nodeUid);
    } catch {
      toast.error("Failed to unblock subject");
    }
  };

  if (!hasAnyCapability(["federation.nodes.view"])) {
    return (
      <div className="flex items-center justify-center py-24 text-white/45">
        You do not have permission to view federation settings.
      </div>
    );
  }

  if (loading || !status) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-6 w-6 animate-spin rounded-md border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-white/60" />
        <h1 className="text-xl font-semibold">Federation</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-white/10 bg-panel-surface p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              tab === t.key
                ? "bg-white/10 text-white"
                : "text-white/45 hover:text-white/75"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === "overview" && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {status.local_node && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Globe className="h-4 w-4" /> Node Identity
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-white/45">Name</span>
                    <span>{status.local_node.display_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/45">Node UID</span>
                    <span className="font-mono text-xs">
                      {status.local_node.node_uid}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/45">Active Key</span>
                    <span className="font-mono text-xs">
                      {status.local_node.active_key_id}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/45">API URL</span>
                    <span className="truncate max-w-[160px]">
                      {status.local_node.api_base_url || "-"}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Radio className="h-4 w-4" /> Protocol
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-white/45">Protocol</span>
                    <span>v1</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/45">Signature</span>
                    <span>crate-ed25519-v1</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/45">Descriptor</span>
                    <a
                      href={`${
                        status.local_node.api_base_url || window.location.origin
                      }/.well-known/crate-node`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" /> well-known
                    </a>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Globe className="h-4 w-4" /> Network
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/45">Peers</span>
                <span>{status.peer_count}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/45">Approved</span>
                <span className="text-green-400">
                  {status.approved_peer_count}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/45">Pending</span>
                <span className="text-amber-400">
                  {status.pending_pairing_count}
                </span>
              </div>
            </CardContent>
          </Card>

          {streamingStats && streamingStats.peers.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Radio className="h-4 w-4" /> Streaming
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {streamingStats.peers.map((ps) => (
                  <div
                    key={ps.node_uid}
                    className="border-b border-white/5 pb-2 last:border-0 last:pb-0"
                  >
                    <div className="flex justify-between">
                      <span className="text-white/60">{ps.display_name}</span>
                      <span className="text-xs text-white/35">{ps.preset}</span>
                    </div>
                    <div className="flex justify-between mt-1 text-xs">
                      <span className="text-white/45">
                        Active streams:{" "}
                        <span className="text-white/75">
                          {ps.active_streams}
                        </span>
                      </span>
                      <span className="text-white/45">
                        Today:{" "}
                        <span className="text-white/75">
                          {formatBytes(ps.daily_bytes)}
                        </span>
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Peers */}
      {tab === "peers" && (
        <div className="space-y-6">
          {/* Probe */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Probe Node</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Input
                placeholder="https://api.example.net"
                value={probeUrl}
                onChange={(e) => setProbeUrl(e.target.value)}
                className="max-w-md"
              />
              <Button
                onClick={handleProbe}
                disabled={probing || !probeUrl}
                variant="secondary"
                size="sm"
              >
                {probing ? "Probing..." : "Probe"}
              </Button>
            </CardContent>
            {probeResult && (
              <CardContent className="border-t border-white/5 pt-4">
                <pre className="text-xs text-white/60 overflow-auto max-h-64">
                  {JSON.stringify(probeResult, null, 2)}
                </pre>
              </CardContent>
            )}
          </Card>

          {/* Pair */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Pair with Node</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Input
                placeholder="https://api.example.net"
                value={pairingUrl}
                onChange={(e) => setPairingUrl(e.target.value)}
                className="max-w-md"
              />
              <Button
                onClick={handlePair}
                disabled={!pairingUrl}
                variant="secondary"
                size="sm"
              >
                <Plus className="h-4 w-4 mr-1" /> Pair
              </Button>
            </CardContent>
            {pairingResult && (
              <CardContent className="border-t border-white/5 pt-4">
                <pre className="text-xs text-white/60 overflow-auto max-h-64">
                  {JSON.stringify(pairingResult, null, 2)}
                </pre>
              </CardContent>
            )}
          </Card>

          {/* Community Directory */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Community Directory</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-[minmax(0,1.2fr)_180px]">
              <Input
                placeholder="https://community.cratemusic.app/manifest.json"
                value={directoryUrl}
                onChange={(e) => setDirectoryUrl(e.target.value)}
              />
              <Input
                placeholder="Key ID"
                value={directoryKeyId}
                onChange={(e) => setDirectoryKeyId(e.target.value)}
              />
              <Input
                placeholder="Directory public key"
                value={directoryPublicKey}
                onChange={(e) => setDirectoryPublicKey(e.target.value)}
                className="md:col-span-2"
              />
              <Button
                onClick={handleImportDirectory}
                disabled={importingDir || !directoryUrl || !directoryPublicKey}
                variant="secondary"
                size="sm"
                className="md:w-fit"
              >
                {importingDir ? "Importing..." : "Import"}
              </Button>
            </CardContent>
            <CardContent className="text-xs text-white/35">
              Import a signed community manifest to discover candidate nodes.
              Each peer still requires explicit approval.
            </CardContent>
            {directoryResult && (
              <CardContent className="border-t border-white/5 pt-4">
                <pre className="text-xs text-white/60 overflow-auto max-h-64">
                  {JSON.stringify(directoryResult, null, 2)}
                </pre>
              </CardContent>
            )}
          </Card>

          {/* Peer list */}
          <div>
            <h3 className="text-sm font-medium mb-3">Known Peers</h3>
            {status.peers.length === 0 ? (
              <p className="text-sm text-white/45">No peers configured.</p>
            ) : (
              <div className="space-y-3">
                {status.peers.map((peer) => (
                  <Card key={peer.node_uid}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {peer.display_name}
                            </span>
                            <Badge
                              variant={
                                peer.trust_state === "approved"
                                  ? "default"
                                  : peer.trust_state === "disabled"
                                    ? "destructive"
                                    : "secondary"
                              }
                              className="text-xs"
                            >
                              {peer.trust_state}
                            </Badge>
                            {peer.disabled_at && (
                              <Badge variant="destructive" className="text-xs">
                                disabled
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-white/45 mt-1 font-mono">
                            {peer.node_uid}
                          </div>
                          <div className="text-xs text-white/45">
                            {peer.api_base_url}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {peer.trust_state === "pending" &&
                            hasAnyCapability(["federation.nodes.manage"]) && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  handleApprovePairing(peer.node_uid)
                                }
                              >
                                <CheckCircle className="h-4 w-4 mr-1" /> Approve
                              </Button>
                            )}
                          {peer.trust_state === "approved" &&
                            hasAnyCapability([
                              "federation.catalog.sync.manage",
                            ]) && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => handleSyncCatalog(peer.node_uid)}
                              >
                                <RefreshCw className="h-4 w-4 mr-1" /> Sync
                              </Button>
                            )}
                          {(peer.trust_state === "approved" ||
                            peer.trust_state === "pending") &&
                            hasAnyCapability(["federation.nodes.manage"]) && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleDisablePeer(peer.node_uid)}
                              >
                                <XCircle className="h-4 w-4 mr-1" /> Disable
                              </Button>
                            )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Presets */}
      {tab === "presets" && (
        <div>
          <h3 className="text-sm font-medium mb-3">Peer Presets</h3>
          {status.peers.filter((p) => p.trust_state === "approved").length ===
          0 ? (
            <p className="text-sm text-white/45">No approved peers.</p>
          ) : (
            <div className="space-y-3">
              {status.peers
                .filter((p) => p.trust_state === "approved")
                .map((peer) => (
                  <Card key={peer.node_uid}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium">
                            {peer.display_name}
                          </span>
                          <div className="text-xs text-white/45 mt-1 font-mono">
                            {peer.node_uid}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {PRESETS.map((preset) => (
                            <Button
                              key={preset}
                              size="sm"
                              variant={
                                peer.default_grant_preset === preset
                                  ? "default"
                                  : "secondary"
                              }
                              onClick={() =>
                                handleSetPreset(peer.node_uid, preset)
                              }
                              disabled={
                                !hasAnyCapability(["federation.nodes.manage"])
                              }
                              className="text-xs"
                            >
                              {preset === "trusted_library"
                                ? "Trusted"
                                : preset.charAt(0).toUpperCase() +
                                  preset.slice(1)}
                            </Button>
                          ))}
                        </div>
                      </div>
                      {peer.default_grant_preset === "listen" && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-amber-400">
                          <AlertTriangle className="h-3 w-3" /> stream.original
                          not included
                        </div>
                      )}
                      {peer.default_grant_preset === "trusted_library" && (
                        <div className="mt-2 flex items-center gap-1 text-xs text-amber-400">
                          <AlertTriangle className="h-3 w-3" /> stream.original
                          and import enabled
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Subjects */}
      {tab === "subjects" && (
        <div className="space-y-6">
          <div className="flex gap-2 flex-wrap">
            {status.peers
              .filter((p) => p.trust_state === "approved")
              .map((peer) => (
                <Button
                  key={peer.node_uid}
                  size="sm"
                  variant={
                    subjectsNode === peer.node_uid ? "default" : "secondary"
                  }
                  onClick={() => loadSubjects(peer.node_uid)}
                >
                  {peer.display_name}
                </Button>
              ))}
          </div>

          {subjectsNode && subjects[subjectsNode] && (
            <div>
              <h3 className="text-sm font-medium mb-3">
                Remote Subjects ({subjects[subjectsNode].length})
              </h3>
              {subjects[subjectsNode].length === 0 ? (
                <p className="text-sm text-white/45">No subjects seen yet.</p>
              ) : (
                <div className="space-y-2">
                  {subjects[subjectsNode].map((subject) => (
                    <Card key={subject.id}>
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-mono text-xs">
                              {subject.subject_hash}
                            </span>
                            {subject.blocked_at && (
                              <Badge
                                variant="destructive"
                                className="ml-2 text-xs"
                              >
                                blocked
                              </Badge>
                            )}
                            <div className="text-xs text-white/45 mt-1">
                              Last seen: {subject.last_seen_at || "-"}
                            </div>
                          </div>
                          <div>
                            {subject.blocked_at ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() =>
                                  handleUnblockSubject(
                                    subjectsNode,
                                    subject.subject_hash,
                                  )
                                }
                                disabled={
                                  !hasAnyCapability(["federation.nodes.manage"])
                                }
                              >
                                <CheckCircle className="h-3 w-3 mr-1" /> Unblock
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() =>
                                  handleBlockSubject(
                                    subjectsNode,
                                    subject.subject_hash,
                                  )
                                }
                                disabled={
                                  !hasAnyCapability(["federation.nodes.manage"])
                                }
                              >
                                <UserX className="h-3 w-3 mr-1" /> Block
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Audit */}
      {tab === "audit" && (
        <div>
          <h3 className="text-sm font-medium mb-3">Recent Events</h3>
          {!audit || audit.length === 0 ? (
            <p className="text-sm text-white/45">No audit events.</p>
          ) : (
            <div className="space-y-1">
              {audit.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-xs border border-white/5"
                >
                  <Badge
                    variant={
                      event.status === "success" || event.status === "approved"
                        ? "default"
                        : "secondary"
                    }
                    className="shrink-0"
                  >
                    {event.status}
                  </Badge>
                  <span className="text-white/75">{event.event_type}</span>
                  {event.node_uid && (
                    <span className="text-white/35 font-mono truncate">
                      {event.node_uid}
                    </span>
                  )}
                  <span className="text-white/35 ml-auto shrink-0">
                    {event.created_at
                      ? new Date(event.created_at).toLocaleString()
                      : "-"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Admin copy: fine-grained grants not exposed */}
      {tab === "presets" && (
        <div className="mt-4 rounded-lg border border-white/5 bg-panel-surface p-3 text-xs text-white/35">
          Fine-grained grant editing is not yet available. Use presets to manage
          peer access. Advanced constraint controls will be added after the
          basic federation path has real usage.
        </div>
      )}
    </div>
  );
}
