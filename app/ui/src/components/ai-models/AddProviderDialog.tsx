import { useState, type FormEvent } from "react";

import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Button } from "@crate/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";
import { Input } from "@crate/ui/shadcn/input";

import { providerLabel, splitConnections } from "@/lib/ai-models";

import { reportFailure, writeAI } from "./api";
import type { Connection, Snapshot } from "./types";

type AddableProvider = "gemini" | "deepseek" | "ollama";

const PROVIDER_ITEMS = [
  { value: "gemini" as const, label: "Gemini" },
  { value: "deepseek" as const, label: "DeepSeek" },
  { value: "ollama" as const, label: "Ollama" },
];

const PROVIDER_ENV_VAR: Record<string, string> = {
  gemini: "GEMINI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
};

function hiddenProviderLine(connection: Connection): string {
  if (connection.provider === "ollama") {
    return "Ollama: add it here with its address.";
  }
  const envVar = PROVIDER_ENV_VAR[connection.provider] ?? null;
  return envVar
    ? `${providerLabel(connection.provider)}: set ${envVar} on the server to use it.`
    : `${providerLabel(connection.provider)}: not available from the server environment.`;
}

export function AddProviderDialog({
  snapshot,
  open,
  onOpenChange,
  refresh,
}: {
  snapshot: Snapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  refresh: () => void;
}) {
  const [provider, setProvider] = useState<AddableProvider>("gemini");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);

  const { hidden } = splitConnections(snapshot);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await writeAI("/connections", {
        label: name,
        provider,
        endpoint: provider === "ollama" ? address : null,
      });
      setName("");
      setAddress("");
      onOpenChange(false);
      refresh();
    } catch (error) {
      reportFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Add provider</DialogTitle>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <SegmentedControl
            as="radio"
            label="Provider"
            value={provider}
            onValueChange={setProvider}
            items={PROVIDER_ITEMS}
          />
          <label className="block space-y-1 text-sm text-white/70">
            Name
            <Input
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {provider === "ollama" ? (
            <label className="block space-y-1 text-sm text-white/70">
              Address
              <Input
                type="url"
                required
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </label>
          ) : null}
          <DialogFooter>
            <Button type="submit" disabled={busy || !name}>
              Add provider
            </Button>
          </DialogFooter>
        </form>
        {hidden.length > 0 ? (
          <section className="space-y-1 border-t border-white/10 pt-4 text-sm text-white/60">
            <h3 className="font-semibold text-white/80">
              From the server environment
            </h3>
            <ul className="space-y-1">
              {hidden.map((connection) => (
                <li key={connection.id}>{hiddenProviderLine(connection)}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
