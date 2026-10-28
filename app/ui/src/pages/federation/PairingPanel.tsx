import { FormField } from "@crate/ui/primitives/FormField";
import { MonoLabel } from "@crate/ui/primitives/MonoLabel";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { Button } from "@crate/ui/shadcn/button";
import { Card, CardContent, CardHeader } from "@crate/ui/shadcn/card";
import { Input } from "@crate/ui/shadcn/input";

export function PairingPanel({
  canManage,
  onChanged,
}: {
  canManage: boolean;
  onChanged: () => void;
}) {
  const [probeUrl, setProbeUrl] = useState("");
  const [pairingUrl, setPairingUrl] = useState("");
  const [probe, setProbe] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (kind: "probe" | "pair") => {
    setBusy(true);
    try {
      const result = await api<Record<string, unknown>>(
        kind === "probe"
          ? "/api/admin/federation/nodes/probe"
          : "/api/admin/federation/pairing/start",
        "POST",
        { url: kind === "probe" ? probeUrl : pairingUrl },
      );
      if (kind === "probe") setProbe(result);
      else onChanged();
      toast.success(kind === "probe" ? "Node probed" : "Pairing started");
    } catch {
      toast.error("Federation request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <MonoLabel as="h3" tone="accent">
          Pairing
        </MonoLabel>
      </CardHeader>
      <CardContent className="space-y-3">
        <FormField label="Probe URL">
          {(control) => (
            <div
              data-slot="pairing-input-row"
              className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2 items-end"
            >
              <Input
                {...control}
                aria-label="Probe URL"
                value={probeUrl}
                onChange={(event) => setProbeUrl(event.target.value)}
                placeholder="https://node.example"
                className="min-w-0"
              />
              <Button
                variant="secondary"
                disabled={busy || !probeUrl}
                onClick={() => void run("probe")}
                className="w-full"
              >
                Probe
              </Button>
            </div>
          )}
        </FormField>
        {probe ? (
          <pre className="max-h-40 overflow-auto rounded-md border border-border-quiet bg-card p-3 font-mono text-xs text-text-secondary">
            {JSON.stringify(probe, null, 2)}
          </pre>
        ) : null}
        {canManage ? (
          <FormField label="Pairing URL">
            {(control) => (
              <div
                data-slot="pairing-input-row"
                className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2 items-end"
              >
                <Input
                  {...control}
                  aria-label="Pairing URL"
                  value={pairingUrl}
                  onChange={(event) => setPairingUrl(event.target.value)}
                  placeholder="https://node.example"
                  className="min-w-0"
                />
                <Button
                  disabled={busy || !pairingUrl}
                  onClick={() => void run("pair")}
                  className="w-full"
                >
                  Pair
                </Button>
              </div>
            )}
          </FormField>
        ) : null}
      </CardContent>
    </Card>
  );
}
