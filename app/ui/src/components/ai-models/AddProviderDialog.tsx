import { useState, type FormEvent } from "react";

import { FormField } from "@crate/ui/primitives/FormField";
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
import {
  compatibleRequest,
  emptyCompatibleDraft,
  OpenAICompatibleFields,
  type CompatibleDraft,
} from "./OpenAICompatibleFields";
import type { Connection, Snapshot } from "./types";

type AddableProvider = "gemini" | "deepseek" | "ollama" | "openai_compatible";

const PROVIDER_ITEMS = [
  { value: "gemini" as const, label: "Gemini" },
  { value: "deepseek" as const, label: "DeepSeek" },
  { value: "ollama" as const, label: "Ollama" },
  { value: "openai_compatible" as const, label: "OpenAI-compatible" },
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
  const [compatible, setCompatible] =
    useState<CompatibleDraft>(emptyCompatibleDraft);
  const [busy, setBusy] = useState(false);

  const { hidden } = splitConnections(snapshot);
  const compatibleFields =
    provider === "openai_compatible" ? compatibleRequest(compatible) : null;
  const ready =
    Boolean(name) &&
    (provider !== "openai_compatible" || compatibleFields !== null);

  function close() {
    setProvider("gemini");
    setName("");
    setAddress("");
    setCompatible(emptyCompatibleDraft());
    onOpenChange(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setBusy(true);
    try {
      await writeAI(
        "/connections",
        compatibleFields
          ? { label: name, provider, ...compatibleFields }
          : {
              label: name,
              provider,
              endpoint: provider === "ollama" ? address : null,
            },
      );
      close();
      refresh();
    } catch (error) {
      reportFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-request would hide its outcome; a closed form starts over.
        if (busy) return;
        if (next) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        size={provider === "openai_compatible" ? "xl" : "md"}
        className="flex max-h-[min(92dvh,960px)] flex-col overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle className="font-display">Add provider</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => void submit(event)}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          {/* A manifest can outgrow the viewport: only the fields scroll, so
              the title and the submit button stay reachable. */}
          <div
            data-testid="add-provider-body"
            className="-m-1 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-1"
          >
            <SegmentedControl
              as="radio"
              label="Provider"
              value={provider}
              onValueChange={setProvider}
              items={PROVIDER_ITEMS}
            />
            <FormField label="Name">
              <Input
                required
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </FormField>
            {provider === "ollama" ? (
              <FormField label="Address">
                <Input
                  type="url"
                  required
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                />
              </FormField>
            ) : null}
            {provider === "openai_compatible" ? (
              <OpenAICompatibleFields
                draft={compatible}
                disabled={busy}
                onChange={setCompatible}
              />
            ) : null}
            {hidden.length > 0 ? (
              <section className="space-y-1 border-t border-border-quiet pt-4 text-sm text-text-muted">
                <h3 className="font-semibold text-text-secondary font-display">
                  From the server environment
                </h3>
                <ul className="space-y-1">
                  {hidden.map((connection) => (
                    <li key={connection.id}>
                      {hiddenProviderLine(connection)}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy || !ready}>
              Add provider
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
