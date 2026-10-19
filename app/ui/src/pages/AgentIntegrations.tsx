import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { KeyRound, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { Badge } from "@crate/ui/shadcn/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@crate/ui/shadcn/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@crate/ui/shadcn/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { api, ApiError } from "@/lib/api";
import {
  permissionLabels,
  type AgentCatalog,
  type AgentCollection,
  type AgentIntegration,
  type AgentSecret,
} from "@/lib/agent-integrations";

const base = "/api/admin/agent-integrations";

export function AgentIntegrations() {
  const { hasCapability } = useAuth();
  const canManage = hasCapability("agents.integrations.manage");
  const canReadActivity = hasCapability("agents.activity.view");
  const [cursor, setCursor] = useState<string | null>(null);
  const integrations = useApi<AgentCollection<AgentIntegration>>(
    canManage
      ? `${base}?limit=20${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
        }`
      : null,
  );
  const catalog = useApi<AgentCatalog>(canManage ? `${base}/catalog` : null);
  const [clientCursor, setClientCursor] = useState<string | null>(null);
  const clients = useApi<
    AgentCollection<{
      client_id: string;
      name: string;
      enabled: boolean;
      scopes: string[];
    }>
  >(
    canManage
      ? `${base}/oauth-clients${
          clientCursor ? `?cursor=${encodeURIComponent(clientCursor)}` : ""
        }`
      : null,
  );
  const [editor, setEditor] = useState<AgentIntegration | "create" | null>(
    null,
  );
  const [name, setName] = useState("");
  const [grants, setGrants] = useState<string[]>([]);
  const [days, setDays] = useState(90);
  const [reviewRequired, setReviewRequired] = useState(false);
  const [secret, setSecret] = useState<AgentSecret | null>(null);
  const [busy, setBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [stalePolicy, setStalePolicy] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    action: () => Promise<unknown>;
  } | null>(null);
  const [activityId, setActivityId] = useState<string | null>(null);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const activity = useApi<
    AgentCollection<{
      id: number;
      timestamp: string;
      action: string;
      target?: string;
      user_id?: number | null;
      evidence: {
        principal_id?: string;
        authorization_id?: string;
        actor_user_id?: number | null;
        client_id?: string;
        artist_uid?: string;
        before?: boolean | null;
        after?: boolean | null;
        tool?: string;
        job_id?: string;
        plan_id?: string;
        execution?: string;
        verification?: string;
      };
    }>
  >(
    activityId && canReadActivity
      ? `${base}/${encodeURIComponent(activityId)}/activity?limit=20${
          activityCursor ? `&cursor=${encodeURIComponent(activityCursor)}` : ""
        }`
      : null,
  );
  const [clientForm, setClientForm] = useState(false);
  const [editingClient, setEditingClient] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [redirects, setRedirects] = useState("");
  const [clientGrants, setClientGrants] = useState<string[]>([
    "library.health.read",
  ]);
  const [useMetadata, setUseMetadata] = useState(false);

  function refresh() {
    integrations.refetch();
    clients.refetch();
    activity.refetch();
  }
  async function mutate(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      refresh();
      toast.success("Integration updated");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update the integration",
      );
    } finally {
      setBusy(false);
    }
  }
  function openEditor(item: AgentIntegration | "create") {
    setName(item === "create" ? "" : item.name);
    setGrants(item === "create" ? ["library.health.read"] : [...item.grants]);
    setReviewRequired(item === "create" ? false : item.require_approval);
    setEditError(null);
    setStalePolicy(false);
    setEditor(item);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor || busy || stalePolicy) return;
    setBusy(true);
    setEditError(null);
    try {
      if (editor === "create") {
        const result = await api<AgentSecret>(base, "POST", {
          name,
          grants,
          expires_in_days: days,
          require_approval: reviewRequired,
        });
        setSecret(result);
      } else {
        await api(`${base}/${editor.principal_id}`, "PATCH", {
          grants,
          require_approval: reviewRequired,
          expected_policy_revision: editor.policy_revision,
        });
      }
      setEditor(null);
      refresh();
    } catch (error) {
      setEditError(
        error instanceof Error
          ? error.message
          : "Could not save. Reload the policy and review your changes.",
      );
      if (
        (error instanceof ApiError || error instanceof Error) &&
        "status" in error &&
        error.status === 409
      )
        setStalePolicy(true);
    } finally {
      setBusy(false);
    }
  }
  async function reloadPolicy() {
    if (!editor || editor === "create" || busy) return;
    setBusy(true);
    try {
      const current = await api<AgentIntegration>(
        `${base}/${encodeURIComponent(editor.principal_id)}`,
      );
      setEditor(current);
      setStalePolicy(false);
      setEditError(
        "Policy reloaded. Your proposed permissions are preserved; review them before saving.",
      );
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "Could not reload policy",
      );
    } finally {
      setBusy(false);
    }
  }
  async function copySecret() {
    if (!secret) return;
    if (!navigator.clipboard) {
      toast.error("Copy is unavailable. Select and copy the token above.");
      return;
    }
    try {
      await navigator.clipboard.writeText(secret.token);
      toast.success("Token copied");
    } catch {
      toast.error("Could not copy token. Select and copy it above.");
    }
  }
  function permissions(selected: string[], update: (value: string[]) => void) {
    const selectedScopes = new Set(selected);
    return (
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Permissions</legend>
        {catalog.data?.scopes.map(({ scope, can_grant }) => (
          <label key={scope} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selectedScopes.has(scope)}
              disabled={!can_grant || busy}
              onChange={(event) =>
                update(
                  event.target.checked
                    ? [...selected, scope]
                    : selected.filter((value) => value !== scope),
                )
              }
            />
            {permissionLabels[scope] ?? scope}
            {!can_grant ? (
              <span className="text-muted-foreground">
                Requires additional permission
              </span>
            ) : null}
          </label>
        ))}
      </fieldset>
    );
  }
  async function saveClient(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api(
        editingClient
          ? `${base}/oauth-clients/update`
          : `${base}/oauth-clients`,
        "POST",
        editingClient
          ? {
              client_id: clientId,
              scopes: clientGrants,
            }
          : {
              client_id: clientId,
              name: clientName,
              redirect_uris: redirects
                .split("\n")
                .map((value) => value.trim())
                .filter(Boolean),
              scopes: clientGrants,
              metadata_url: useMetadata ? clientId : null,
            },
      );
      setClientForm(false);
      clients.refetch();
      toast.success(
        editingClient
          ? "OAuth client permissions updated"
          : "OAuth client registered",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not register client",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!canManage)
    return (
      <p className="p-6 text-muted-foreground">
        You do not have permission to manage agent integrations.
      </p>
    );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          onClick={refresh}
          aria-label="Refresh integrations"
        >
          <RefreshCw className="size-4" />
        </Button>
        <Button onClick={() => openEditor("create")}>
          <Plus className="mr-2 size-4" />
          Service integration
        </Button>
      </div>
      {catalog.data ? (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <Badge variant={catalog.data.mcp_enabled ? "default" : "secondary"}>
              {catalog.data.mcp_enabled ? "MCP enabled" : "MCP disabled"}
            </Badge>
            <span className="text-sm">
              Actions {catalog.data.actions_enabled ? "enabled" : "disabled"} ·
              OAuth {catalog.data.oauth_enabled ? "enabled" : "disabled"}
            </span>
            <p className="text-sm text-muted-foreground">
              {catalog.data.limits.calls_per_minute} calls/min ·{" "}
              {catalog.data.limits.concurrent_calls} concurrent calls ·{" "}
              {catalog.data.limits.active_maintenance_jobs} active maintenance
              job per integration
            </p>
            {hasCapability("agents.plans.review") ? (
              <Button variant="link" asChild>
                <Link to="/agent-plans">Review plans</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {integrations.loading ? <p role="status">Loading integrations…</p> : null}
      {integrations.error || catalog.error ? (
        <p role="alert" className="text-destructive">
          {integrations.error || catalog.error}
        </p>
      ) : null}
      {!integrations.loading && integrations.data?.items.length === 0 ? (
        <p className="text-muted-foreground">No agent integrations yet.</p>
      ) : null}
      <div className="grid gap-4">
        {integrations.data?.items.map((item) => (
          <Card key={item.principal_id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <ShieldCheck className="size-4" />
                {item.name}
                <Badge variant="secondary">
                  {item.kind === "delegated" ? "Connected account" : "Service"}
                </Badge>
                <Badge variant={item.enabled ? "default" : "secondary"}>
                  {item.enabled ? "Enabled" : "Disabled"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {item.grants.map((grant) => (
                  <Badge key={grant} variant="outline">
                    {permissionLabels[grant] ?? grant}
                  </Badge>
                ))}
              </div>
              {catalog.data ? (
                <details className="text-sm">
                  <summary className="cursor-pointer">
                    Available operations and access requirements
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {catalog.data.tools.map((tool) => (
                      <li key={tool.name}>
                        <span className="font-medium">
                          {tool.name.replace(/_/g, " ")}
                        </span>{" "}
                        ·{" "}
                        {!item.enabled
                          ? "Integration disabled"
                          : !tool.enabled
                            ? tool.reason
                            : tool.grant && !item.grants.includes(tool.grant)
                              ? "Permission not granted"
                              : !tool.grant
                                ? "Permission depends on the selected diagnostic source"
                                : item.kind === "delegated"
                                  ? "Granted, subject to the connected account's current permissions"
                                  : "Granted"}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <p className="text-sm text-muted-foreground">
                {item.require_approval
                  ? "Changes require human review"
                  : "Granted photo-flag changes can run directly"}{" "}
                · Last activity:{" "}
                {item.last_activity_at
                  ? new Date(item.last_activity_at).toLocaleString()
                  : "No recorded activity"}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => openEditor(item)}>
                  Edit permissions
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    setConfirmation({
                      title: item.enabled
                        ? `Disable ${item.name}?`
                        : `Enable ${item.name}?`,
                      action: () =>
                        api(`${base}/${item.principal_id}`, "PATCH", {
                          enabled: !item.enabled,
                          expected_policy_revision: item.policy_revision,
                        }),
                    })
                  }
                >
                  {item.enabled ? "Disable" : "Enable"}
                </Button>
                {canReadActivity ? (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setActivityCursor(null);
                      setActivityId(item.principal_id);
                    }}
                  >
                    Activity
                  </Button>
                ) : null}
              </div>
              {item.kind === "service"
                ? item.credentials
                    ?.filter((credential) => !credential.revoked_at)
                    .map((credential) => (
                      <div
                        key={credential.credential_id}
                        className="flex flex-wrap items-center gap-2 border-t border-border pt-3"
                      >
                        <KeyRound className="size-4" />
                        <span className="text-sm">
                          Expires{" "}
                          {new Date(credential.expires_at).toLocaleDateString()}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            mutate(async () => {
                              const result = await api<AgentSecret>(
                                `${base}/credentials/${credential.credential_id}/rotate`,
                                "POST",
                                { expires_in_days: 90 },
                              );
                              setSecret(result);
                            })
                          }
                        >
                          Rotate token
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setConfirmation({
                              title: `Revoke access for ${item.name}?`,
                              action: () =>
                                api(
                                  `${base}/credentials/${credential.credential_id}/revoke`,
                                  "POST",
                                ),
                            })
                          }
                        >
                          Revoke
                        </Button>
                      </div>
                    ))
                : item.authorizations?.map((authorization) => (
                    <div
                      key={authorization.authorization_id}
                      className="flex flex-wrap items-center gap-2 border-t border-border pt-3"
                    >
                      <span className="text-sm">
                        User {authorization.user_id} · {authorization.client_id}
                      </span>
                      {authorization.revoked_at ? (
                        <Badge variant="secondary">Revoked</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setConfirmation({
                              title: `Disconnect ${item.name}?`,
                              action: () =>
                                api(
                                  `${base}/authorizations/${authorization.authorization_id}/revoke`,
                                  "POST",
                                ),
                            })
                          }
                        >
                          Disconnect
                        </Button>
                      )}
                    </div>
                  ))}
              {item.credentials_truncated || item.authorizations_truncated ? (
                <p className="text-xs text-muted-foreground">
                  Showing the latest 20 access records, with current access
                  first. Older changes remain in activity.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex gap-2">
        {cursor ? (
          <Button variant="outline" onClick={() => setCursor(null)}>
            First page
          </Button>
        ) : null}
        {integrations.data?.next_cursor ? (
          <Button
            variant="outline"
            onClick={() => setCursor(integrations.data!.next_cursor!)}
          >
            Next integrations
          </Button>
        ) : null}
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">OAuth clients</CardTitle>
          <Button
            variant="outline"
            onClick={() => {
              setEditingClient(false);
              setClientId("");
              setClientName("");
              setRedirects("");
              setClientGrants(["library.health.read"]);
              setUseMetadata(false);
              setClientForm(true);
            }}
          >
            Register client
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {clients.error ? <p role="alert">{clients.error}</p> : null}
          {clients.data?.items.map((client) => (
            <div
              key={client.client_id}
              className="flex items-center justify-between gap-3"
            >
              <div>
                <p className="font-medium">{client.name}</p>
                <p className="break-all text-sm text-muted-foreground">
                  {client.client_id}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setEditingClient(true);
                  setClientId(client.client_id);
                  setClientName(client.name);
                  setClientGrants([...client.scopes]);
                  setClientForm(true);
                }}
              >
                Edit client permissions
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  setConfirmation({
                    title: `${client.enabled ? "Disable" : "Enable"} ${
                      client.name
                    }?`,
                    action: () =>
                      api(`${base}/oauth-clients/update`, "POST", {
                        client_id: client.client_id,
                        enabled: !client.enabled,
                      }),
                  })
                }
              >
                {client.enabled ? "Disable client" : "Enable client"}
              </Button>
            </div>
          ))}
          {clientCursor ? (
            <Button variant="outline" onClick={() => setClientCursor(null)}>
              First client page
            </Button>
          ) : null}
          {clients.data?.next_cursor ? (
            <Button
              variant="outline"
              onClick={() => setClientCursor(clients.data!.next_cursor!)}
            >
              Next clients
            </Button>
          ) : null}
          {clients.data?.items.length === 0 ? (
            <p className="text-muted-foreground">
              Register a client before connecting an account.
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setEditor(null);
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editor === "create"
                ? "Create service integration"
                : "Edit integration permissions"}
            </DialogTitle>
            <DialogDescription>
              Grant only the access this integration needs.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            {editor === "create" ? (
              <>
                <label className="grid gap-1 text-sm">
                  Name
                  <Input
                    required
                    value={name}
                    maxLength={120}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Expires in days
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={days}
                    onChange={(event) => setDays(Number(event.target.value))}
                  />
                </label>
              </>
            ) : null}
            {permissions(grants, setGrants)}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={reviewRequired}
                onChange={(event) => setReviewRequired(event.target.checked)}
              />
              Require human review before changes
            </label>
            {editError ? (
              <p role="alert" className="text-destructive">
                {editError}
              </p>
            ) : null}
            {stalePolicy ? (
              <Button
                variant="outline"
                type="button"
                disabled={busy}
                onClick={() => void reloadPolicy()}
              >
                Reload policy
              </Button>
            ) : null}
            <Button
              disabled={busy || stalePolicy || grants.length === 0}
              type="submit"
            >
              {busy ? "Saving…" : "Save integration"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={secret !== null}
        onOpenChange={(open) => {
          if (!open) setSecret(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this token</DialogTitle>
            <DialogDescription>
              It is shown once. Store it in your agent's secret store before
              closing.
            </DialogDescription>
          </DialogHeader>
          <textarea
            aria-label="Integration token"
            className="w-full rounded-md border border-border bg-background p-3 text-sm"
            readOnly
            value={secret?.token ?? ""}
          />
          <Button onClick={() => void copySecret()}>Copy token</Button>
          <Button variant="outline" onClick={() => setSecret(null)}>
            Done
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={activityId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setActivityId(null);
            setActivityCursor(null);
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Integration activity</DialogTitle>
            <DialogDescription>
              Recorded access and operation outcomes. Acceptance does not imply
              completion.
            </DialogDescription>
          </DialogHeader>
          {activity.error ? <p role="alert">{activity.error}</p> : null}
          {activity.data?.items
            .filter(
              (entry) =>
                !entry.evidence.principal_id ||
                entry.evidence.principal_id === activityId,
            )
            .map((entry) => (
              <div
                key={entry.id}
                className="border-b border-border py-2 text-sm"
              >
                <p>
                  {entry.action} · {new Date(entry.timestamp).toLocaleString()}
                </p>
                <p className="text-muted-foreground">
                  {entry.evidence.tool} {entry.evidence.execution}{" "}
                  {entry.evidence.verification}
                </p>
                {entry.evidence.actor_user_id || entry.user_id ? (
                  <p className="text-muted-foreground">
                    User {entry.evidence.actor_user_id ?? entry.user_id}
                    {entry.evidence.client_id
                      ? ` · Client ${entry.evidence.client_id}`
                      : ""}
                  </p>
                ) : null}
                {entry.evidence.authorization_id ? (
                  <p className="text-xs text-muted-foreground">
                    Connection {entry.evidence.authorization_id}
                  </p>
                ) : null}
                {entry.evidence.artist_uid || entry.target ? (
                  <p className="text-muted-foreground">
                    Target {entry.evidence.artist_uid ?? entry.target}
                  </p>
                ) : null}
                {typeof entry.evidence.before === "boolean" &&
                typeof entry.evidence.after === "boolean" ? (
                  <p>
                    Photo flag: {String(entry.evidence.before)} →{" "}
                    {String(entry.evidence.after)}
                  </p>
                ) : null}
                {entry.evidence.plan_id ? (
                  <Link
                    className="underline"
                    to={`/agent-plans/${encodeURIComponent(
                      entry.evidence.plan_id,
                    )}`}
                  >
                    View plan
                  </Link>
                ) : null}
                {entry.evidence.job_id ? (
                  <Link
                    className="ml-3 underline"
                    to={`/tasks?task=${encodeURIComponent(
                      entry.evidence.job_id,
                    )}`}
                  >
                    View job
                  </Link>
                ) : null}
              </div>
            ))}
          {activity.data?.next_cursor ? (
            <Button
              variant="outline"
              onClick={() => setActivityCursor(activity.data!.next_cursor!)}
            >
              Older activity
            </Button>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={clientForm} onOpenChange={setClientForm}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingClient
                ? "Edit OAuth client permissions"
                : "Register OAuth client"}
            </DialogTitle>
            <DialogDescription>
              Use the client ID and exact callback addresses supplied by the
              agent application.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveClient} className="space-y-4">
            {editingClient ? (
              <p className="text-sm break-all">
                {clientName} · {clientId}
              </p>
            ) : (
              <>
                <label className="grid gap-1 text-sm">
                  Client name
                  <Input
                    required
                    value={clientName}
                    onChange={(event) => setClientName(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Client ID
                  <Input
                    required
                    value={clientId}
                    onChange={(event) => setClientId(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Callback addresses (one per line)
                  <textarea
                    required
                    className="rounded-md border border-border bg-background p-2"
                    value={redirects}
                    onChange={(event) => setRedirects(event.target.value)}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={useMetadata}
                    onChange={(event) => setUseMetadata(event.target.checked)}
                  />
                  Verify the client ID as a public metadata document
                </label>
              </>
            )}
            {permissions(clientGrants, setClientGrants)}
            <Button type="submit" disabled={busy || clientGrants.length === 0}>
              {editingClient
                ? "Save client permissions"
                : "Register OAuth client"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
        title={confirmation?.title ?? "Update integration?"}
        description="Access changes apply to new requests and pending worker effects. Applied changes remain recorded."
        onConfirm={() => {
          const action = confirmation?.action;
          setConfirmation(null);
          if (action) void mutate(action);
        }}
      />
    </div>
  );
}
