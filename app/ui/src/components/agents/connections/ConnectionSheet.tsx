import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Switch } from "@crate/ui/primitives/Switch";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@crate/ui/shadcn/sheet";

import { CopyButton } from "@/components/admin/CopyButton";
import { RelativeTime } from "@/components/admin/RelativeTime";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { TechnicalDetails } from "@/components/admin/TechnicalDetails";
import { ConfirmDialog } from "@crate/ui/composites/ConfirmDialog";
import { useNow } from "@/hooks/use-now";
import { api } from "@/lib/api";
import {
  activityText,
  approvalPolicyText,
  connectionStatus,
} from "@/lib/agent-connections";
import type {
  AgentCatalog,
  AgentIntegration,
  AgentSecret,
} from "@/lib/agent-integrations";
import {
  apiErrorText,
  connectionKindLabel,
} from "@/lib/agent-plan-presentation";
import {
  isTechnicalString,
  type TechnicalItem,
} from "@/lib/agent-plan-technical";
import { humanizeKey } from "@/lib/humanize";

import { ConnectionSnippets } from "./ConnectionSnippets";
import { PermissionPicker } from "./PermissionPicker";
import { useCursorList } from "./use-cursor-list";

const base = "/api/admin/agent-integrations";
const ACCESS_CHANGE_NOTE =
  "Access changes apply to new requests and pending worker effects. Applied changes remain recorded.";
const CONFLICT_TEXT = "This connection changed since you opened it.";
const RELOADED_WHILE_EDITING =
  "Policy reloaded. Your proposed permissions are preserved; review them before saving.";

/** One audit entry as returned by `GET /{id}/activity`. */
export interface AgentActivityEntry {
  id: number;
  timestamp: string;
  action: string;
  target?: string | null;
  user_id?: number | null;
  evidence: {
    principal_id?: string | null;
    authorization_id?: string | null;
    actor_user_id?: number | string | null;
    client_id?: string | null;
    artist_uid?: string | null;
    before?: boolean | null;
    after?: boolean | null;
    tool?: string | null;
    job_id?: string | null;
    plan_id?: string | null;
    execution?: string | null;
    verification?: string | null;
  };
}

type PolicyChange = Partial<
  Pick<AgentIntegration, "enabled" | "grants" | "require_approval">
>;

interface Confirmation {
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
  run: () => Promise<unknown>;
}

function isConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 409
  );
}

function numbered(label: string, index: number, count: number): string {
  return count > 1 ? `${label} ${index + 1}` : label;
}

function SheetSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3 py-5 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-sm font-semibold text-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function GrantedPermissions({
  grants,
  catalog,
}: {
  grants: string[];
  catalog: AgentCatalog;
}) {
  if (grants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No permissions granted.</p>
    );
  }
  const byScope = new Map(catalog.scopes.map((scope) => [scope.scope, scope]));
  const knownGroups = new Set(catalog.scope_groups.map((group) => group.id));
  const groups = catalog.scope_groups
    .map((group) => ({
      id: group.id,
      label: group.label,
      scopes: grants
        .map((grant) => byScope.get(grant))
        .filter((scope) => scope !== undefined && scope.group === group.id)
        .map((scope) => scope!),
    }))
    .filter((group) => group.scopes.length > 0);
  // Grants the catalog does not describe, or that sit in a group it does not
  // list, are still shown; their id stays in the title only.
  const other = grants.filter((grant) => {
    const scope = byScope.get(grant);
    return !scope || !knownGroups.has(scope.group);
  });

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.id} className="space-y-1.5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {group.label}
          </p>
          <ul className="space-y-1">
            {group.scopes.map((scope) => (
              <li
                key={scope.scope}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <span title={scope.scope}>{scope.label}</span>
                {scope.access === "change" ? (
                  <StatusBadge tone="warning">Can change</StatusBadge>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {other.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Other
          </p>
          <ul className="space-y-1">
            {other.map((grant) => {
              const scope = byScope.get(grant);
              return (
                <li
                  key={grant}
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <span title={grant}>
                    {scope?.label ?? "Unknown permission"}
                  </span>
                  {!scope || scope.access === "change" ? (
                    <StatusBadge tone="warning">Can change</StatusBadge>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function TokenReveal({
  secret,
  mcpUrl,
  mcpEnabled,
  onDone,
}: {
  secret: AgentSecret;
  mcpUrl: string | null;
  mcpEnabled: boolean;
  onDone: () => void;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <p className="text-sm text-destructive">
        This token is shown only once. Copy it now.
      </p>
      <div className="flex items-center gap-2">
        <Input
          readOnly
          aria-label="New token"
          value={secret.token}
          className="min-w-0 font-mono"
        />
        <CopyButton value={secret.token} label="token" />
      </div>
      <p className="text-sm text-muted-foreground">
        Expires <RelativeTime value={secret.expires_at} />
      </p>
      <ConnectionSnippets
        url={mcpUrl}
        token={secret.token}
        mcpEnabled={mcpEnabled}
      />
      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function ActivityRow({
  entry,
  principalId,
}: {
  entry: AgentActivityEntry;
  principalId: string;
}) {
  const { evidence } = entry;
  const actor = evidence.actor_user_id ?? entry.user_id ?? null;
  const target = evidence.artist_uid ?? entry.target ?? null;
  const technical: TechnicalItem[] = [];
  let visibleTarget: string | null = null;
  // Admin events record the connection itself as their target.
  if (target && target !== principalId) {
    if (isTechnicalString(target))
      technical.push({ label: "Target", value: target });
    else visibleTarget = target;
  }
  if (evidence.authorization_id)
    technical.push({ label: "Sign-in ID", value: evidence.authorization_id });
  const outcome = [
    evidence.execution ? `Execution: ${humanizeKey(evidence.execution)}` : null,
    evidence.verification
      ? `Verification: ${humanizeKey(evidence.verification)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const hasFlagDiff =
    typeof evidence.before === "boolean" && typeof evidence.after === "boolean";

  return (
    <li className="space-y-1 rounded-md border border-white/10 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="font-medium text-foreground">
          {activityText({
            action: entry.action,
            evidence: { tool: evidence.tool ?? undefined },
          })}
        </p>
        <span className="text-xs text-muted-foreground">
          <RelativeTime value={entry.timestamp} />
        </span>
      </div>
      {actor !== null ? (
        <p className="text-muted-foreground [overflow-wrap:anywhere]">
          {evidence.client_id
            ? `User #${actor} · ${evidence.client_id}`
            : `User #${actor}`}
        </p>
      ) : null}
      {visibleTarget ? (
        <p className="text-muted-foreground [overflow-wrap:anywhere]">
          {`Target ${visibleTarget}`}
        </p>
      ) : null}
      {hasFlagDiff ? (
        <p>
          {`Photo flag: ${evidence.before ? "on" : "off"} → ${
            evidence.after ? "on" : "off"
          }`}
        </p>
      ) : null}
      {outcome ? <p className="text-muted-foreground">{outcome}</p> : null}
      {evidence.plan_id || evidence.job_id ? (
        <div className="flex flex-wrap gap-3">
          {evidence.plan_id ? (
            <Link
              className="text-primary underline-offset-4 hover:underline"
              to={`/agents/approvals/${encodeURIComponent(evidence.plan_id)}`}
            >
              Open plan
            </Link>
          ) : null}
          {evidence.job_id ? (
            <Link
              className="text-primary underline-offset-4 hover:underline"
              to={`/tasks?task=${encodeURIComponent(evidence.job_id)}`}
            >
              Open job
            </Link>
          ) : null}
        </div>
      ) : null}
      {technical.length > 0 ? <TechnicalDetails items={technical} /> : null}
    </li>
  );
}

/**
 * Detail and management sheet for one connection: permissions and approval
 * policy (saved with compare-and-set on the policy revision), its token or
 * OAuth sign-ins, recent activity, and enabling or disabling it.
 */
export function ConnectionSheet({
  integration,
  catalog,
  canReadActivity,
  onChanged,
  onClose,
}: {
  integration: AgentIntegration;
  catalog: AgentCatalog;
  canReadActivity: boolean;
  onChanged: (fresh: AgentIntegration) => void;
  onClose: () => void;
}) {
  const now = useNow(60_000);
  // After every change the connection is read again and handed to the page,
  // so this prop is always the server's current copy: policy, tokens and
  // sign-ins alike.
  const policy = integration;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // The one-time token lives only in this sheet's state, so it is gone as
  // soon as the sheet closes and unmounts.
  const [secret, setSecret] = useState<AgentSecret | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const principalPath = `${base}/${encodeURIComponent(
    integration.principal_id,
  )}`;
  const activity = useCursorList<AgentActivityEntry>(
    canReadActivity ? `${principalPath}/activity?limit=20` : null,
    (entry) => entry.id,
  );
  const status = connectionStatus(policy, now);
  const credentials = policy.credentials ?? [];
  const activeCredentials = credentials.filter(
    (credential) => credential.revoked_at === null,
  );
  const authorizations = policy.authorizations ?? [];
  const entries = activity.items.filter(
    (entry) =>
      !entry.evidence.principal_id ||
      entry.evidence.principal_id === integration.principal_id,
  );
  const policyLocked = busy || conflict;

  /** Reads the connection again and passes the fresh copy up. */
  async function reread(): Promise<boolean> {
    try {
      const fresh = await api<AgentIntegration>(principalPath);
      if (fresh?.principal_id !== integration.principal_id) return false;
      onChanged(fresh);
      return true;
    } catch (error) {
      toast.error(apiErrorText(error, "Could not reload this connection."));
      return false;
    }
  }

  async function changed() {
    activity.reload();
    await reread();
  }

  async function patchPolicy(
    change: PolicyChange,
    success: string,
    inlineErrors = false,
  ): Promise<boolean> {
    if (busy || conflict) return false;
    setBusy(true);
    setFormError(null);
    setNotice(null);
    try {
      await api(principalPath, "PATCH", {
        ...change,
        expected_policy_revision: policy.policy_revision,
      });
      // Busy until the fresh copy is in, so a second change never sends the
      // revision this one just replaced.
      await changed();
      toast.success(success);
      return true;
    } catch (error) {
      if (isConflict(error)) {
        setConflict(true);
      } else {
        const message = apiErrorText(error, "Could not update the connection.");
        if (inlineErrors) setFormError(message);
        else toast.error(message);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reloadPolicy() {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    try {
      if (await reread()) {
        setConflict(false);
        setNotice(editing ? RELOADED_WHILE_EDITING : "Policy reloaded.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      await changed();
      toast.success(success);
    } catch (error) {
      toast.error(apiErrorText(error, "Could not update the connection."));
    } finally {
      setBusy(false);
    }
  }

  function startEditing() {
    setDraft([...policy.grants]);
    setFormError(null);
    setNotice(null);
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setFormError(null);
    setNotice(null);
  }

  async function savePermissions() {
    const saved = await patchPolicy(
      { grants: draft, require_approval: policy.require_approval },
      "Permissions saved",
      true,
    );
    if (saved) setEditing(false);
  }

  function confirmRotate(credentialId: string) {
    setConfirmation({
      title: `Rotate the token for ${policy.name}?`,
      description:
        "The current token stops working right away. The new token is shown once.",
      confirmLabel: "Rotate token",
      destructive: true,
      run: () =>
        run(async () => {
          const result = await api<AgentSecret>(
            `${base}/credentials/${encodeURIComponent(credentialId)}/rotate`,
            "POST",
            { expires_in_days: 90 },
          );
          setSecret(result);
        }, "Token rotated"),
    });
  }

  function confirmRevoke(credentialId: string) {
    setConfirmation({
      title: `Revoke access for ${policy.name}?`,
      description: ACCESS_CHANGE_NOTE,
      confirmLabel: "Revoke token",
      destructive: true,
      run: () =>
        run(
          () =>
            api(
              `${base}/credentials/${encodeURIComponent(credentialId)}/revoke`,
              "POST",
            ),
          "Token revoked",
        ),
    });
  }

  function confirmDisconnect(authorizationId: string) {
    setConfirmation({
      title: `Disconnect ${policy.name}?`,
      description: ACCESS_CHANGE_NOTE,
      confirmLabel: "Disconnect",
      destructive: true,
      run: () =>
        run(
          () =>
            api(
              `${base}/authorizations/${encodeURIComponent(
                authorizationId,
              )}/revoke`,
              "POST",
            ),
          "Sign-in disconnected",
        ),
    });
  }

  function confirmToggleEnabled() {
    const enabling = !policy.enabled;
    setConfirmation({
      title: enabling ? `Enable ${policy.name}?` : `Disable ${policy.name}?`,
      description: ACCESS_CHANGE_NOTE,
      confirmLabel: enabling ? "Enable connection" : "Disable connection",
      destructive: !enabling,
      run: () =>
        patchPolicy(
          { enabled: enabling },
          enabling ? "Connection enabled" : "Connection disabled",
        ),
    });
  }

  const technicalItems: TechnicalItem[] = [
    { label: "Connection ID", value: policy.principal_id },
    { label: "Policy revision", value: policy.policy_revision },
    ...credentials.map((credential, index) => ({
      label: numbered("Credential ID", index, credentials.length),
      value: credential.credential_id,
    })),
    ...authorizations.map((authorization, index) => ({
      label: numbered("Sign-in ID", index, authorizations.length),
      value: authorization.authorization_id,
    })),
  ];

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader className="pr-14">
          <SheetTitle className="text-lg [overflow-wrap:anywhere]">
            {policy.name}
          </SheetTitle>
          <SheetDescription>
            {`${connectionKindLabel(policy.kind)} · ${approvalPolicyText(
              policy.require_approval,
            )}`}
          </SheetDescription>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </SheetHeader>

        <div className="px-4 pb-6">
          {conflict ? (
            <div className="mb-5 space-y-2 rounded-md border border-border p-3">
              <p role="alert" className="text-sm text-destructive">
                {CONFLICT_TEXT}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void reloadPolicy()}
              >
                Reload policy
              </Button>
            </div>
          ) : null}
          {notice ? (
            <p role="status" className="mb-5 text-sm text-muted-foreground">
              {notice}
            </p>
          ) : null}

          <div className="divide-y divide-white/8">
            <SheetSection
              title="Permissions"
              action={
                editing ? null : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-label="Edit permissions"
                    disabled={policyLocked}
                    onClick={startEditing}
                  >
                    Edit
                  </Button>
                )
              }
            >
              {editing ? (
                <div className="space-y-4">
                  <PermissionPicker
                    catalog={catalog}
                    value={draft}
                    onChange={setDraft}
                    disabled={policyLocked}
                  />
                  {formError ? (
                    <p role="alert" className="text-sm text-destructive">
                      {formError}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={cancelEditing}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={policyLocked || draft.length === 0}
                      onClick={() => void savePermissions()}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <GrantedPermissions grants={policy.grants} catalog={catalog} />
              )}
            </SheetSection>

            <SheetSection title="Approval">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={policy.require_approval}
                  disabled={policyLocked}
                  onCheckedChange={(next) =>
                    void patchPolicy(
                      { grants: policy.grants, require_approval: next },
                      "Approval policy saved",
                    )
                  }
                />
                Require approval before changes
              </label>
              <p className="text-sm text-muted-foreground">
                High-risk and whole-library changes always need approval.
              </p>
            </SheetSection>

            {policy.kind === "service" ? (
              <SheetSection title="Token">
                {activeCredentials.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    This connection has no active token.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {activeCredentials.map((credential) => (
                      <li
                        key={credential.credential_id}
                        className="flex flex-col gap-2 rounded-md border border-white/10 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <p className="text-sm">
                          {Date.parse(credential.expires_at) <= now
                            ? "Token expired "
                            : "Token expires "}
                          <RelativeTime value={credential.expires_at} />
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy || !policy.enabled}
                            onClick={() =>
                              confirmRotate(credential.credential_id)
                            }
                          >
                            Rotate token
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="danger-soft"
                            disabled={busy}
                            onClick={() =>
                              confirmRevoke(credential.credential_id)
                            }
                          >
                            Revoke token
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {!policy.enabled && activeCredentials.length > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Enable the connection to rotate its token.
                  </p>
                ) : null}
                {secret ? (
                  <TokenReveal
                    secret={secret}
                    mcpUrl={catalog.mcp_url}
                    mcpEnabled={catalog.mcp_enabled}
                    onDone={() => setSecret(null)}
                  />
                ) : null}
                {policy.credentials_truncated ? (
                  <p className="text-xs text-muted-foreground">
                    Showing the latest 20 tokens, with current access first.
                    Older changes remain in activity.
                  </p>
                ) : null}
              </SheetSection>
            ) : (
              <SheetSection title="Sign-ins">
                {authorizations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No one has signed in with this connection.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {authorizations.map((authorization) => (
                      <li
                        key={authorization.authorization_id}
                        className="flex flex-col gap-2 rounded-md border border-white/10 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <p className="min-w-0 text-sm [overflow-wrap:anywhere]">
                          {`User #${authorization.user_id} · ${authorization.client_id}`}
                        </p>
                        {authorization.revoked_at ? (
                          <StatusBadge>Revoked</StatusBadge>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="danger-soft"
                            disabled={busy}
                            onClick={() =>
                              confirmDisconnect(authorization.authorization_id)
                            }
                          >
                            Disconnect
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {policy.authorizations_truncated ? (
                  <p className="text-xs text-muted-foreground">
                    Showing the latest 20 sign-ins, with current access first.
                    Older changes remain in activity.
                  </p>
                ) : null}
              </SheetSection>
            )}

            {canReadActivity ? (
              <SheetSection title="Activity">
                <p className="text-sm text-muted-foreground">
                  Recorded access and operation outcomes. Acceptance does not
                  imply completion.
                </p>
                {activity.loading && entries.length === 0 ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Loading activity…
                  </p>
                ) : null}
                {activity.error ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="text-sm text-destructive">
                      {apiErrorText(
                        activity.error,
                        "The activity could not be loaded.",
                      )}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={activity.retry}
                    >
                      Try again
                    </Button>
                  </div>
                ) : null}
                {!activity.loading &&
                !activity.error &&
                entries.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No activity recorded yet.
                  </p>
                ) : null}
                {entries.length > 0 ? (
                  <ul className="space-y-2">
                    {entries.map((entry) => (
                      <ActivityRow
                        key={entry.id}
                        entry={entry}
                        principalId={integration.principal_id}
                      />
                    ))}
                  </ul>
                ) : null}
                {activity.nextCursor && !activity.error ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={activity.loadingMore}
                    onClick={activity.loadMore}
                  >
                    {activity.loadingMore ? "Loading more…" : "Load more"}
                  </Button>
                ) : null}
              </SheetSection>
            ) : null}

            <SheetSection title="Danger zone">
              <p className="text-sm text-muted-foreground">
                {policy.enabled
                  ? "Disabling stops this agent from using Crate until you enable it again."
                  : "This connection is disabled. Enable it to let the agent use Crate again."}
              </p>
              <Button
                type="button"
                size="sm"
                variant={policy.enabled ? "danger-soft" : "outline"}
                disabled={policyLocked}
                onClick={confirmToggleEnabled}
              >
                {policy.enabled ? "Disable connection" : "Enable connection"}
              </Button>
            </SheetSection>

            <div className="pt-5">
              <TechnicalDetails items={technicalItems} />
            </div>
          </div>
        </div>

        <ConfirmDialog
          open={confirmation !== null}
          onOpenChange={(open) => {
            if (!open) setConfirmation(null);
          }}
          title={confirmation?.title ?? ""}
          description={confirmation?.description ?? ""}
          confirmLabel={confirmation?.confirmLabel}
          variant={confirmation?.destructive ? "destructive" : "default"}
          onConfirm={() => {
            const pending = confirmation;
            setConfirmation(null);
            if (pending) void pending.run();
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
