import { useId, useState, type FormEvent } from "react";

import { Switch } from "@crate/ui/primitives/Switch";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { FormField } from "@crate/ui/primitives/FormField";

import { RelativeTime } from "@/components/admin/RelativeTime";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import {
  connectionName,
  formatCount,
  numberInputValue,
  providerLabel,
  providerStatus,
} from "@/lib/ai-models";

import { JobProgress, reportFailure, writeAI } from "./api";
import type { Connection, Enqueued } from "./types";

function keyLine(connection: Connection): string {
  if (connection.source === "environment" && connection.has_key) {
    const suffix = connection.last4 ? ` · ending ${connection.last4}` : "";
    return `Key: from server environment, read-only${suffix}`;
  }
  if (connection.has_key) return "Key: saved in Crate";
  return "No key";
}

function ModelsLine({ connection }: { connection: Connection }) {
  if (connection.model_count === 0) return <p>Models not loaded</p>;
  const count = `${formatCount(connection.model_count)} models`;
  if (!connection.catalog_updated_at) return <p>{count}</p>;
  return (
    <p>
      {count} · updated <RelativeTime value={connection.catalog_updated_at} />
    </p>
  );
}

// The connection limits the API accepts.
const LIMITS = {
  daily_calls: 100000,
  daily_tokens: 1000000000,
  max_concurrent: 8,
};

function withinLimit(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= max;
}

function KeyForm({
  connection,
  refresh,
}: {
  connection: Connection;
  refresh: () => void;
}) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(value: string | null) {
    setBusy(true);
    try {
      await writeAI(
        `/connections/${encodeURIComponent(connection.id)}/credential`,
        { api_key: value, expected_revision: connection.revision },
      );
    } catch (error) {
      reportFailure(error);
    } finally {
      setBusy(false);
      setKey("");
      // Also after a failure: a conflict leaves the revision stale.
      refresh();
    }
  }

  return (
    <div className="space-y-2">
      <FormField
        label="API key"
        hint="Keys are write-only. Crate never shows them again."
        className="min-w-0"
      >
        <Input
          type="password"
          aria-label="API key"
          autoComplete="new-password"
          maxLength={4096}
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !key} onClick={() => void submit(key)}>
          Save key
        </Button>
        <Button
          variant="outline"
          disabled={busy || !connection.has_key}
          onClick={() => void submit(null)}
        >
          Remove key
        </Button>
      </div>
    </div>
  );
}

/**
 * Keyed on the connection revision by its parent: a newer revision (someone
 * else's change, or our own save) restarts the form from the saved values, so
 * saving never sends stale fields back.
 */
function LimitsForm({
  connection,
  refresh,
}: {
  connection: Connection;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState(connection.label);
  const [endpoint, setEndpoint] = useState(connection.endpoint ?? "");
  const [enabled, setEnabled] = useState(connection.enabled);
  const [dailyCalls, setDailyCalls] = useState(connection.daily_calls);
  const [dailyTokens, setDailyTokens] = useState(connection.daily_tokens);
  const [maxConcurrent, setMaxConcurrent] = useState(connection.max_concurrent);
  const isOllama = connection.provider === "ollama";
  const valid =
    withinLimit(dailyCalls, LIMITS.daily_calls) &&
    withinLimit(dailyTokens, LIMITS.daily_tokens) &&
    withinLimit(maxConcurrent, LIMITS.max_concurrent);

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      await writeAI(
        `/connections/${encodeURIComponent(connection.id)}`,
        {
          label,
          // Hosted providers keep whatever endpoint the API holds.
          ...(isOllama ? { endpoint: endpoint || null } : {}),
          enabled,
          daily_calls: dailyCalls,
          daily_tokens: dailyTokens,
          max_concurrent: maxConcurrent,
          expected_revision: connection.revision,
        },
        "PATCH",
      );
    } catch (error) {
      reportFailure(error);
    } finally {
      setBusy(false);
      refresh();
    }
  }

  return (
    <form
      onSubmit={(event) => void saveSettings(event)}
      className="grid min-w-0 items-end gap-3 sm:grid-cols-2 xl:grid-cols-3"
    >
      <FormField label="Name" className="min-w-0">
        <Input
          required
          maxLength={200}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </FormField>
      {isOllama ? (
        <FormField label="Endpoint" className="min-w-0">
          <Input
            type="url"
            required
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
          />
        </FormField>
      ) : null}
      <FormField label="Daily calls" className="min-w-0">
        <Input
          type="number"
          min={1}
          max={LIMITS.daily_calls}
          required
          value={numberInputValue(dailyCalls)}
          onChange={(event) => setDailyCalls(event.target.valueAsNumber)}
        />
      </FormField>
      <FormField label="Daily tokens" className="min-w-0">
        <Input
          type="number"
          min={1}
          max={LIMITS.daily_tokens}
          required
          value={numberInputValue(dailyTokens)}
          onChange={(event) => setDailyTokens(event.target.valueAsNumber)}
        />
      </FormField>
      <FormField label="At a time" className="min-w-0">
        <Input
          type="number"
          min={1}
          max={LIMITS.max_concurrent}
          required
          value={numberInputValue(maxConcurrent)}
          onChange={(event) => setMaxConcurrent(event.target.valueAsNumber)}
        />
      </FormField>
      <FormField
        label="Connection enabled"
        layout="inline"
        className="self-end"
      >
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </FormField>
      <Button type="submit" disabled={busy || !valid}>
        Save settings
      </Button>
    </form>
  );
}

const MODEL_ID_PATTERN = "[A-Za-z0-9][A-Za-z0-9._:/-]*";

function ManualModelForm({
  connection,
  refresh,
}: {
  connection: Connection;
  refresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [modelId, setModelId] = useState("");

  async function addModel(event: FormEvent) {
    event.preventDefault();
    if (!modelId) return;
    setBusy(true);
    try {
      await writeAI(
        `/connections/${encodeURIComponent(connection.id)}/models`,
        {
          model_id: modelId,
          expected_revision: connection.revision,
        },
      );
      setModelId("");
    } catch (error) {
      reportFailure(error, "That model ID isn't valid.");
    } finally {
      setBusy(false);
      refresh();
    }
  }

  return (
    <form
      onSubmit={(event) => void addModel(event)}
      className="flex flex-wrap items-end gap-2"
    >
      <FormField label="Model ID" className="min-w-0">
        <Input
          aria-label="Model ID"
          required
          maxLength={200}
          pattern={MODEL_ID_PATTERN}
          value={modelId}
          onChange={(event) => setModelId(event.target.value)}
        />
      </FormField>
      <Button type="submit" disabled={busy || !modelId}>
        Add model
      </Button>
    </form>
  );
}

function SettingsSection({
  connection,
  refresh,
}: {
  connection: Connection;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();

  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        aria-expanded={open}
        aria-controls={open ? contentId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        Settings
      </Button>
      {open ? (
        <div id={contentId} className="mt-3 space-y-4">
          <LimitsForm
            key={connection.revision}
            connection={connection}
            refresh={refresh}
          />
          <ManualModelForm connection={connection} refresh={refresh} />
          <p className="text-xs text-text-muted">
            Added models stay pending until Crate can confirm what they support.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function ProviderCard({
  connection,
  refresh,
}: {
  connection: Connection;
  refresh: () => void;
}) {
  const { hasCapability } = useAuth();
  const canManage = hasCapability("ai.config.manage");
  const canManageCredentials = hasCapability("ai.credentials.manage");
  const status = providerStatus(connection);
  const name = connectionName(connection);

  // The latest refresh this card started. A finished one stays on screen so
  // its outcome remains readable until the next refresh.
  const [refreshJob, setRefreshJob] = useState<{
    job: Enqueued;
    finished: boolean;
  } | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);

  async function refreshModels() {
    setRefreshBusy(true);
    try {
      const result = await writeAI<Enqueued>(
        `/connections/${encodeURIComponent(connection.id)}/refresh`,
        { expected_revision: connection.revision },
      );
      setRefreshJob((current) =>
        // A deduplicated acceptance names no job: keep following ours while it
        // runs; otherwise another refresh is running elsewhere.
        !result.task_id && current && !current.finished
          ? current
          : { job: result, finished: false },
      );
    } catch (error) {
      reportFailure(error);
      // A conflict leaves the revision stale; read the current one.
      refresh();
    } finally {
      setRefreshBusy(false);
    }
  }

  return (
    <article
      aria-label={name}
      className="space-y-3 rounded-md border border-border-quiet bg-surface-container p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium text-text-primary font-display">{name}</h3>
          <p className="text-sm text-text-muted">
            {providerLabel(connection.provider)}
          </p>
        </div>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>

      <div className="space-y-1 text-sm text-text-secondary">
        <p>{keyLine(connection)}</p>
        <p>Endpoint: {connection.endpoint ?? "provider default"}</p>
        <ModelsLine connection={connection} />
        {connection.catalog_status === "error" ? (
          <p>Couldn&apos;t load models. The last list is kept.</p>
        ) : null}
      </div>

      {canManage ? (
        <div className="space-y-2">
          <Button
            variant="outline"
            disabled={refreshBusy}
            aria-label={`Refresh models for ${name}`}
            onClick={() => void refreshModels()}
          >
            Refresh models
          </Button>
          <JobProgress
            job={refreshJob?.job ?? null}
            kind="refresh"
            onComplete={() => {
              setRefreshJob((current) =>
                current ? { ...current, finished: true } : current,
              );
              refresh();
            }}
          />
        </div>
      ) : null}

      {connection.read_only ? (
        <p className="text-sm text-text-muted">
          Limits: {formatCount(connection.max_concurrent)} at a time ·{" "}
          {formatCount(connection.daily_calls)} calls ·{" "}
          {formatCount(connection.daily_tokens)} tokens per day
        </p>
      ) : (
        <>
          {canManageCredentials ? (
            <KeyForm connection={connection} refresh={refresh} />
          ) : null}
          {canManage ? (
            <SettingsSection connection={connection} refresh={refresh} />
          ) : null}
        </>
      )}
    </article>
  );
}
