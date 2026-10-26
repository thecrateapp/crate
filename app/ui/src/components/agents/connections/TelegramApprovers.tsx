import { useId, useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";

import { OpsPanel } from "@/components/admin/ops-surfaces";
import { RelativeTime } from "@/components/admin/RelativeTime";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import type { AgentIntegration } from "@/lib/agent-integrations";
import { apiErrorText } from "@/lib/agent-plan-presentation";

const base = "/api/admin/agent-telegram";
const OPERATOR_NAME = "Crate Operator";

export interface TelegramBinding {
  binding_id: string;
  principal_id: string;
  principal_name: string | null;
  user_id: number | null;
  username: string | null;
  telegram_user_id: number;
  created_at: string;
}

export interface TelegramBindings {
  instance_id: string | null;
  items: TelegramBinding[];
}

function approverLabel(binding: TelegramBinding): string {
  if (binding.username) return binding.username;
  return binding.user_id !== null ? `User #${binding.user_id}` : "Unknown user";
}

function defaultConnection(connections: AgentIntegration[]): string {
  const operator = connections.find(
    (connection) => connection.name === OPERATOR_NAME,
  );
  return (operator ?? connections[0])?.principal_id ?? "";
}

function BindingRow({
  binding,
  disabled,
  onRemove,
}: {
  binding: TelegramBinding;
  disabled: boolean;
  onRemove: () => void;
}) {
  const nameId = useId();
  return (
    <li className="flex flex-col gap-3 rounded-md border border-white/10 bg-white/[0.02] p-4 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0 space-y-1">
        <p id={nameId} className="font-medium [overflow-wrap:anywhere]">
          {binding.principal_name ?? "Unnamed connection"}
        </p>
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {`Approver ${approverLabel(binding)} · Telegram user ${
            binding.telegram_user_id
          }`}
        </p>
        <p className="text-sm text-muted-foreground">
          Bound <RelativeTime value={binding.created_at} />
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="danger-soft"
        aria-describedby={nameId}
        disabled={disabled}
        onClick={onRemove}
      >
        Remove
      </Button>
    </li>
  );
}

/**
 * Who approves Crate Operator plans from Telegram: binds the signed-in
 * account to a Telegram user for one service connection.
 */
export function TelegramApprovers({
  connections,
}: {
  connections: AgentIntegration[];
}) {
  const bindings = useApi<TelegramBindings>(`${base}/bindings`);
  const [principalId, setPrincipalId] = useState(() =>
    defaultConnection(connections),
  );
  const [telegramUserId, setTelegramUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<TelegramBinding | null>(
    null,
  );
  const connectionField = useId();
  const telegramField = useId();
  const telegramHint = useId();

  const selected =
    connections.find((connection) => connection.principal_id === principalId)
      ?.principal_id ?? defaultConnection(connections);
  const telegramId = telegramUserId.trim();
  const validTelegramId = /^[1-9][0-9]{0,18}$/.test(telegramId);
  const configured = Boolean(bindings.data?.instance_id);
  const items = configured ? bindings.data?.items ?? [] : [];

  async function bind(event: FormEvent) {
    event.preventDefault();
    if (busy || !selected || !validTelegramId) return;
    setBusy(true);
    try {
      await api(`${base}/bind`, "POST", {
        principal_id: selected,
        telegram_user_id: Number(telegramId),
      });
      toast.success("Telegram approver bound");
      setTelegramUserId("");
      bindings.refetch();
    } catch (error) {
      toast.error(apiErrorText(error, "Could not bind the approver."));
    } finally {
      setBusy(false);
    }
  }

  async function remove(binding: TelegramBinding) {
    setBusy(true);
    try {
      await api(
        `${base}/bindings/${encodeURIComponent(binding.binding_id)}`,
        "DELETE",
      );
      toast.success("Telegram approver removed");
      bindings.refetch();
    } catch (error) {
      toast.error(apiErrorText(error, "Could not remove the approver."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <OpsPanel
      icon={ShieldCheck}
      title="Telegram approver"
      description="Crate Operator plan approvals pressed in Telegram count only for the Crate account bound here. Binding links your own account, and the Telegram user must also be in the bot allowlist."
    >
      <div className="space-y-4">
        {bindings.loading && !bindings.data ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading Telegram approvers…
          </p>
        ) : null}
        {bindings.error ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm text-destructive">
              {apiErrorText(
                bindings.error,
                "The Telegram approvers could not be loaded.",
              )}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={bindings.refetch}
            >
              Try again
            </Button>
          </div>
        ) : null}
        {bindings.data && !configured ? (
          <p className="text-sm text-muted-foreground">
            Crate Operator is not set up on this instance. Run{" "}
            <code className="font-mono">
              make agent-init AGENT_PROFILE=operator
            </code>{" "}
            on the stack host first.
          </p>
        ) : null}
        {configured && items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No approver is bound yet. Plans cannot be approved from Telegram
            until one is.
          </p>
        ) : null}
        {items.length > 0 ? (
          <ul className="space-y-3">
            {items.map((binding) => (
              <BindingRow
                key={binding.binding_id}
                binding={binding}
                disabled={busy}
                onRemove={() => setConfirmation(binding)}
              />
            ))}
          </ul>
        ) : null}
        {configured ? (
          connections.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Create the Crate Operator connection before binding an approver.
            </p>
          ) : (
            <form
              onSubmit={bind}
              className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
            >
              <div className="grid gap-1.5 text-sm">
                <label htmlFor={connectionField}>Connection</label>
                <select
                  id={connectionField}
                  value={selected}
                  disabled={busy}
                  onChange={(event) => setPrincipalId(event.target.value)}
                  className="h-10 rounded-md border border-white/10 bg-black/25 px-3 text-sm text-white"
                >
                  {connections.map((connection) => (
                    <option
                      key={connection.principal_id}
                      value={connection.principal_id}
                    >
                      {connection.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5 text-sm">
                <label htmlFor={telegramField}>Your Telegram user ID</label>
                <Input
                  id={telegramField}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={19}
                  value={telegramUserId}
                  aria-describedby={telegramHint}
                  disabled={busy}
                  onChange={(event) => setTelegramUserId(event.target.value)}
                />
              </div>
              <Button
                type="submit"
                disabled={busy || !selected || !validTelegramId}
              >
                Bind me as approver
              </Button>
              <p
                id={telegramHint}
                className="text-sm text-muted-foreground md:col-span-3"
              >
                The numeric ID that @userinfobot replies with. Binding again
                replaces the current approver of that connection and cancels its
                unused approvals.
              </p>
            </form>
          )
        ) : null}
      </div>
      <ConfirmDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
        title={
          confirmation
            ? `Remove the approver of ${
                confirmation.principal_name ?? "this connection"
              }?`
            : ""
        }
        description="Plans from this connection can no longer be approved from Telegram until an approver is bound again. Unused approvals stop working."
        confirmLabel="Remove approver"
        variant="destructive"
        onConfirm={() => {
          const pending = confirmation;
          setConfirmation(null);
          if (pending) void remove(pending);
        }}
      />
    </OpsPanel>
  );
}
