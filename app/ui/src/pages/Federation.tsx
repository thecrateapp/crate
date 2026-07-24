import { useState } from "react";
import { Shield } from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { AuditPanel } from "@/pages/federation/AuditPanel";
import { FederationOverview } from "@/pages/federation/FederationOverview";
import { ImportsPanel } from "@/pages/federation/ImportsPanel";
import { PeersPanel } from "@/pages/federation/PeersPanel";
import { PoliciesPanel } from "@/pages/federation/PoliciesPanel";
import { SecurityPanel } from "@/pages/federation/SecurityPanel";
import { StreamsPanel } from "@/pages/federation/StreamsPanel";

type Tab =
  | "overview"
  | "peers"
  | "policies"
  | "streams"
  | "imports"
  | "security"
  | "audit";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "peers", label: "Peers" },
  { key: "policies", label: "Policies" },
  { key: "streams", label: "Streams" },
  { key: "imports", label: "Imports" },
  { key: "security", label: "Security" },
  { key: "audit", label: "Audit" },
];

export function Federation() {
  const { hasAnyCapability } = useAuth();
  const [tab, setTab] = useState<Tab>("overview");
  const canView = hasAnyCapability(["federation.nodes.view"]);
  const canManage = hasAnyCapability(["federation.nodes.manage"]);
  const canManageImports = hasAnyCapability(["federation.import.manage"]);
  if (!canView)
    return (
      <div className="flex items-center justify-center py-24 text-white/45">
        You do not have permission to view federation settings.
      </div>
    );
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6 text-white/60" />
        <h1 className="text-xl font-semibold">Federation</h1>
      </div>
      <div
        role="tablist"
        aria-label="Federation operations"
        className="flex w-fit flex-wrap gap-1 rounded-lg border border-white/10 bg-panel-surface p-1"
      >
        {TABS.map((item) => (
          <button
            role="tab"
            aria-selected={tab === item.key}
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`rounded-md px-3 py-1.5 text-sm ${
              tab === item.key
                ? "bg-white/10 text-white"
                : "text-white/45 hover:text-white/75"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "overview" ? <FederationOverview /> : null}
      {tab === "peers" ? <PeersPanel canManage={canManage} /> : null}
      {tab === "policies" ? <PoliciesPanel canManage={canManage} /> : null}
      {tab === "streams" ? <StreamsPanel canManage={canManage} /> : null}
      {tab === "imports" ? <ImportsPanel canManage={canManageImports} /> : null}
      {tab === "security" ? <SecurityPanel canManage={canManage} /> : null}
      {tab === "audit" ? <AuditPanel /> : null}
    </div>
  );
}
