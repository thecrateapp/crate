import { useState } from "react";
import { Server } from "lucide-react";

import { Button } from "@crate/ui/shadcn/button";

import { OpsPanel } from "@/components/admin/ops-surfaces";
import { useAuth } from "@/contexts/AuthContext";
import { splitConnections } from "@/lib/ai-models";

import { AddProviderDialog } from "./AddProviderDialog";
import { ProviderCard } from "./ProviderCard";
import type { Snapshot } from "./types";

export function ProvidersPanel({
  snapshot,
  refresh,
}: {
  snapshot: Snapshot;
  refresh: () => void;
}) {
  const canManage = useAuth().hasCapability("ai.config.manage");
  const [dialogOpen, setDialogOpen] = useState(false);
  const { shown } = splitConnections(snapshot);

  return (
    <OpsPanel
      icon={Server}
      title="Providers"
      description="Connections Crate uses to reach model providers. Refreshing models never runs a model."
      action={
        canManage ? (
          <Button onClick={() => setDialogOpen(true)}>Add provider</Button>
        ) : null
      }
    >
      <div className="space-y-4">
        {shown.map((connection) => (
          <ProviderCard
            key={connection.id}
            connection={connection}
            refresh={refresh}
          />
        ))}
      </div>
      {canManage ? (
        <AddProviderDialog
          snapshot={snapshot}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          refresh={refresh}
        />
      ) : null}
    </OpsPanel>
  );
}
