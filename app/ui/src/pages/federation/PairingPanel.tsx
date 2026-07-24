import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { Button } from "@crate/ui/shadcn/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@crate/ui/shadcn/card";
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
        <CardTitle className="text-sm">Pairing</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            aria-label="Probe URL"
            value={probeUrl}
            onChange={(event) => setProbeUrl(event.target.value)}
            placeholder="https://node.example"
          />
          <Button
            variant="secondary"
            disabled={busy || !probeUrl}
            onClick={() => void run("probe")}
          >
            Probe
          </Button>
        </div>
        {probe ? (
          <pre className="max-h-40 overflow-auto text-xs text-white/55">
            {JSON.stringify(probe, null, 2)}
          </pre>
        ) : null}
        {canManage ? (
          <div className="flex gap-2">
            <Input
              aria-label="Pairing URL"
              value={pairingUrl}
              onChange={(event) => setPairingUrl(event.target.value)}
              placeholder="https://node.example"
            />
            <Button
              disabled={busy || !pairingUrl}
              onClick={() => void run("pair")}
            >
              Pair
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
