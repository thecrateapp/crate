import { useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { OpsPageHero } from "@/components/admin/ops-surfaces";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@crate/ui/shadcn/tabs";
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
      <div className="min-w-0 space-y-6">
        <OpsPageHero
          title="Federation"
          description="Manage this node, trusted peers, policies and shared streams."
        />
        <p className="text-sm text-text-muted" role="status">
          You do not have permission to view federation settings.
        </p>
      </div>
    );
  return (
    <div className="min-w-0 space-y-6">
      <OpsPageHero
        title="Federation"
        description="Manage this node, trusted peers, policies and shared streams."
      />
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
        className="gap-5"
      >
        <TabsList aria-label="Federation operations">
          {TABS.map((item) => (
            <TabsTrigger key={item.key} value={item.key}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="mt-0">
          <FederationOverview />
        </TabsContent>
        <TabsContent value="peers" className="mt-0">
          <PeersPanel canManage={canManage} />
        </TabsContent>
        <TabsContent value="policies" className="mt-0">
          <PoliciesPanel canManage={canManage} />
        </TabsContent>
        <TabsContent value="streams" className="mt-0">
          <StreamsPanel canManage={canManage} />
        </TabsContent>
        <TabsContent value="imports" className="mt-0">
          <ImportsPanel canManage={canManageImports} />
        </TabsContent>
        <TabsContent value="security" className="mt-0">
          <SecurityPanel canManage={canManage} />
        </TabsContent>
        <TabsContent value="audit" className="mt-0">
          <AuditPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
