import { useId, useState, type FormEvent } from "react";
import { AppWindow } from "lucide-react";
import { toast } from "sonner";

import { Switch } from "@crate/ui/primitives/Switch";
import { Button } from "@crate/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";
import { Input } from "@crate/ui/shadcn/input";
import { Textarea } from "@crate/ui/shadcn/textarea";

import { OpsPanel } from "@/components/admin/ops-surfaces";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { api } from "@/lib/api";
import { permissionSummary } from "@/lib/agent-connections";
import type { AgentCatalog } from "@/lib/agent-integrations";
import { apiErrorText } from "@/lib/agent-plan-presentation";

import { PermissionPicker } from "./PermissionPicker";
import { useCursorList } from "./use-cursor-list";

const base = "/api/admin/agent-integrations";

export interface AgentOAuthClient {
  client_id: string;
  name: string;
  enabled: boolean;
  scopes: string[];
}

function readOnlyScopes(catalog: AgentCatalog): string[] {
  return (
    catalog.presets.find((preset) => preset.id === "read_only")?.scopes ?? []
  );
}

/**
 * Registers a new OAuth app, or edits only the permissions of an existing
 * one: its name, client id and redirect URIs are never resent on edit.
 */
function OAuthAppDialog({
  catalog,
  client,
  onClose,
  onSaved,
}: {
  catalog: AgentCatalog;
  client: AgentOAuthClient | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = client !== null;
  const [clientId, setClientId] = useState(client?.client_id ?? "");
  const [name, setName] = useState(client?.name ?? "");
  const [redirects, setRedirects] = useState("");
  const [useMetadata, setUseMetadata] = useState(false);
  const [scopes, setScopes] = useState<string[]>(() =>
    client ? [...client.scopes] : readOnlyScopes(catalog),
  );
  const [saving, setSaving] = useState(false);
  const clientIdField = useId();
  const nameField = useId();
  const redirectsField = useId();
  const metadataHint = useId();
  const redirectUris = redirects
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
  const complete = editing
    ? scopes.length > 0
    : Boolean(clientId.trim() && name.trim()) &&
      redirectUris.length > 0 &&
      scopes.length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || !complete) return;
    setSaving(true);
    try {
      await api(
        editing ? `${base}/oauth-clients/update` : `${base}/oauth-clients`,
        "POST",
        editing
          ? { client_id: clientId, scopes }
          : {
              client_id: clientId.trim(),
              name: name.trim(),
              redirect_uris: redirectUris,
              scopes,
              metadata_url: useMetadata ? clientId.trim() : null,
            },
      );
      toast.success(
        editing ? "OAuth app permissions updated" : "OAuth app registered",
      );
      onSaved();
    } catch (error) {
      toast.error(
        apiErrorText(
          error,
          editing
            ? "Could not update the app permissions."
            : "Could not register the app.",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit app permissions" : "Register OAuth app"}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? "Choose the most an account can grant when it signs in with this app."
              : "Use the client ID and exact redirect URIs supplied by the agent application."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {editing ? (
            <div className="space-y-0.5 text-sm">
              <p className="font-medium [overflow-wrap:anywhere]">{name}</p>
              <p className="break-all text-muted-foreground">{clientId}</p>
            </div>
          ) : (
            <>
              <div className="grid gap-1.5 text-sm">
                <label htmlFor={clientIdField}>Client ID</label>
                <Input
                  id={clientIdField}
                  maxLength={2048}
                  value={clientId}
                  aria-describedby={useMetadata ? metadataHint : undefined}
                  onChange={(event) => setClientId(event.target.value)}
                />
                <label className="flex items-center gap-2">
                  <Switch
                    checked={useMetadata}
                    disabled={saving}
                    onCheckedChange={setUseMetadata}
                  />
                  Verify the client ID as a public metadata document
                </label>
                {useMetadata ? (
                  <p id={metadataHint} className="text-muted-foreground">
                    The client ID must be the HTTPS address of the app's
                    metadata document.
                  </p>
                ) : null}
              </div>
              <div className="grid gap-1.5 text-sm">
                <label htmlFor={nameField}>App name</label>
                <Input
                  id={nameField}
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5 text-sm">
                <label htmlFor={redirectsField}>
                  Redirect URIs (one per line)
                </label>
                <Textarea
                  id={redirectsField}
                  value={redirects}
                  className="[overflow-wrap:anywhere]"
                  onChange={(event) => setRedirects(event.target.value)}
                />
              </div>
            </>
          )}
          <PermissionPicker
            catalog={catalog}
            value={scopes}
            onChange={setScopes}
            disabled={saving}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !complete}>
              {editing ? "Save permissions" : "Register app"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OAuthAppRow({
  client,
  catalog,
  disabled,
  onEdit,
  onToggle,
}: {
  client: AgentOAuthClient;
  catalog: AgentCatalog;
  disabled: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const nameId = useId();
  return (
    <li className="flex flex-col gap-3 rounded-md border border-white/10 bg-white/[0.02] p-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p id={nameId} className="font-medium [overflow-wrap:anywhere]">
            {client.name}
          </p>
          <StatusBadge tone={client.enabled ? "success" : "neutral"}>
            {client.enabled ? "Enabled" : "Disabled"}
          </StatusBadge>
        </div>
        <p className="text-sm break-all text-muted-foreground">
          {client.client_id}
        </p>
        <p className="text-sm text-muted-foreground">
          {permissionSummary(client.scopes, catalog.scopes)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-describedby={nameId}
          disabled={disabled}
          onClick={onEdit}
        >
          Edit permissions
        </Button>
        <Button
          type="button"
          size="sm"
          variant={client.enabled ? "danger-soft" : "outline"}
          aria-describedby={nameId}
          disabled={disabled}
          onClick={onToggle}
        >
          {client.enabled ? "Disable" : "Enable"}
        </Button>
      </div>
    </li>
  );
}

/** Secondary panel for the OAuth apps that agents sign in through. */
export function OAuthApps({ catalog }: { catalog: AgentCatalog }) {
  const clients = useCursorList<AgentOAuthClient>(
    `${base}/oauth-clients`,
    (client) => client.client_id,
  );
  const [form, setForm] = useState<AgentOAuthClient | "register" | null>(null);
  const [toggling, setToggling] = useState(false);
  const [confirmation, setConfirmation] = useState<AgentOAuthClient | null>(
    null,
  );

  async function toggle(client: AgentOAuthClient) {
    setToggling(true);
    try {
      await api(`${base}/oauth-clients/update`, "POST", {
        client_id: client.client_id,
        enabled: !client.enabled,
      });
      toast.success(
        client.enabled ? "OAuth app disabled" : "OAuth app enabled",
      );
      clients.reload();
    } catch (error) {
      toast.error(apiErrorText(error, "Could not update the app."));
    } finally {
      setToggling(false);
    }
  }

  return (
    <OpsPanel
      icon={AppWindow}
      title="OAuth apps"
      description="Apps that sign in with a Crate account instead of a token."
      action={
        <Button
          type="button"
          variant="outline"
          onClick={() => setForm("register")}
        >
          Register app
        </Button>
      }
    >
      <div className="space-y-3">
        {clients.loading && clients.items.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading OAuth apps…
          </p>
        ) : null}
        {clients.error ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm text-destructive">
              {apiErrorText(
                clients.error,
                "The OAuth apps could not be loaded.",
              )}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={clients.retry}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {!clients.loading && !clients.error && clients.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Register an app before anyone can connect with OAuth.
          </p>
        ) : null}
        {clients.items.length > 0 ? (
          <ul className="space-y-3">
            {clients.items.map((client) => (
              <OAuthAppRow
                key={client.client_id}
                client={client}
                catalog={catalog}
                disabled={toggling}
                onEdit={() => setForm(client)}
                onToggle={() => setConfirmation(client)}
              />
            ))}
          </ul>
        ) : null}
        {clients.nextCursor && !clients.error ? (
          <Button
            type="button"
            variant="outline"
            disabled={clients.loadingMore}
            onClick={clients.loadMore}
          >
            {clients.loadingMore ? "Loading more…" : "Load more"}
          </Button>
        ) : null}
      </div>
      {form !== null ? (
        <OAuthAppDialog
          key={form === "register" ? "register" : form.client_id}
          catalog={catalog}
          client={form === "register" ? null : form}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            clients.reload();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
        title={
          confirmation
            ? `${confirmation.enabled ? "Disable" : "Enable"} ${
                confirmation.name
              }?`
            : ""
        }
        description={
          confirmation?.enabled
            ? "Agents can no longer sign in with this app. Access changes apply to new requests and pending worker effects."
            : "Agents can sign in with this app again, within the permissions it allows."
        }
        confirmLabel={confirmation?.enabled ? "Disable app" : "Enable app"}
        variant={confirmation?.enabled ? "destructive" : "default"}
        onConfirm={() => {
          const pending = confirmation;
          setConfirmation(null);
          if (pending) void toggle(pending);
        }}
      />
    </OpsPanel>
  );
}
