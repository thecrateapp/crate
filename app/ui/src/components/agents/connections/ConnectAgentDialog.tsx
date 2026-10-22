import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@crate/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";
import { Input } from "@crate/ui/shadcn/input";
import { SegmentedControl } from "@crate/ui/primitives/SegmentedControl";
import { Switch } from "@crate/ui/primitives/Switch";

import { CopyButton } from "@/components/admin/CopyButton";
import { RelativeTime } from "@/components/admin/RelativeTime";
import { api } from "@/lib/api";
import { defaultPresetScopes } from "@/lib/agent-connections";
import type { AgentCatalog, AgentSecret } from "@/lib/agent-integrations";

import { ConnectionSnippets } from "./ConnectionSnippets";
import { PermissionPicker } from "./PermissionPicker";

const base = "/api/admin/agent-integrations";

type TokenLifetime = "30" | "90" | "365";

const LIFETIME_ITEMS: { value: TokenLifetime; label: string }[] = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
];

function defaultGrants(catalog: AgentCatalog): string[] {
  return defaultPresetScopes(catalog.presets, catalog.scopes);
}

/**
 * Three-step guided flow for connecting a new agent: name and token
 * lifetime, permissions and approval policy, then the one-time token with
 * client configuration snippets.
 */
export function ConnectAgentDialog({
  open,
  onOpenChange,
  catalog,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: AgentCatalog;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [lifetime, setLifetime] = useState<TokenLifetime>("90");
  const [grants, setGrants] = useState<string[]>(() => defaultGrants(catalog));
  const [requireApproval, setRequireApproval] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<AgentSecret | null>(null);

  useEffect(() => {
    if (open) return;
    setStep(1);
    setName("");
    setLifetime("90");
    setGrants(defaultGrants(catalog));
    setRequireApproval(true);
    setBusy(false);
    setError(null);
    setSecret(null);
  }, [open]);

  function requestOpenChange(next: boolean) {
    if (!next && busy) return;
    onOpenChange(next);
  }

  function goToPermissions(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) setStep(2);
  }

  async function createConnection(event: FormEvent) {
    event.preventDefault();
    if (busy || grants.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<AgentSecret>(base, "POST", {
        name: name.trim(),
        grants,
        expires_in_days: Number(lifetime),
        require_approval: requireApproval,
      });
      setSecret(result);
      setStep(3);
      onCreated();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create the connection",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Connect your agent</DialogTitle>
          <DialogDescription>Step {step} of 3</DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <form onSubmit={goToPermissions} className="space-y-4">
            <label className="grid gap-1 text-sm">
              Name
              <Input
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Token lifetime</p>
              <SegmentedControl
                as="radio"
                label="Token lifetime"
                items={LIFETIME_ITEMS}
                value={lifetime}
                onValueChange={setLifetime}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={!name.trim()}>
                Next
              </Button>
            </div>
          </form>
        ) : null}

        {step === 2 ? (
          <form onSubmit={createConnection} className="space-y-4">
            <PermissionPicker
              catalog={catalog}
              value={grants}
              onChange={setGrants}
              disabled={busy}
            />
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={requireApproval}
                  onCheckedChange={setRequireApproval}
                  disabled={busy}
                />
                Require approval before changes
              </label>
              <p className="text-sm text-muted-foreground">
                High-risk and whole-library changes always need approval.
              </p>
            </div>
            {error ? (
              <p role="alert" className="text-state-warning-text">
                {error}
              </p>
            ) : null}
            <div className="flex justify-between">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setStep(1)}
              >
                Back
              </Button>
              <Button type="submit" disabled={busy || grants.length === 0}>
                {busy ? "Creating…" : "Create connection"}
              </Button>
            </div>
          </form>
        ) : null}

        {step === 3 && secret ? (
          <div className="space-y-4">
            <p className="text-sm text-state-warning-text">
              This token is shown only once. Copy it now.
            </p>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                aria-label="Token"
                value={secret.token}
                className="font-mono"
              />
              <CopyButton value={secret.token} label="token" />
            </div>
            <p className="text-sm text-muted-foreground">
              Expires <RelativeTime value={secret.expires_at} />
            </p>
            <ConnectionSnippets
              url={catalog.mcp_url}
              token={secret.token}
              mcpEnabled={catalog.mcp_enabled}
            />
            <div className="flex justify-end">
              <Button type="button" onClick={() => requestOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
