import { useId, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { Switch } from "@crate/ui/primitives/Switch";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";

import { RelativeTime } from "@/components/admin/RelativeTime";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import {
  connectionName,
  formatCount,
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
  return (
    <p>
      {formatCount(connection.model_count)} models · updated{" "}
      <RelativeTime value={connection.catalog_updated_at} />
    </p>
  );
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
      refresh();
    } catch (error) {
      reportFailure(error);
    } finally {
      setBusy(false);
      setKey("");
    }
  }

  return (
    <div className="space-y-2">
      <label className="block space-y-1 text-sm text-white/70">
        API key
        <Input
          type="password"
          aria-label="API key"
          autoComplete="new-password"
          maxLength={4096}
          value={key}
          onChange={(event) => setKey(event.target.value)}
        />
      </label>
      <p className="text-xs text-white/45">
        Keys are write-only. Crate never shows them again.
      </p>
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

function SettingsSection({
  connection,
  refresh,
}: {
  connection: Connection;
  refresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState(connection.label);
  const [endpoint, setEndpoint] = useState(connection.endpoint ?? "");
  const [enabled, setEnabled] = useState(connection.enabled);
  const [dailyCalls, setDailyCalls] = useState(connection.daily_calls);
  const [dailyTokens, setDailyTokens] = useState(connection.daily_tokens);
  const [maxConcurrent, setMaxConcurrent] = useState(connection.max_concurrent);
  const [modelId, setModelId] = useState("");

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await writeAI(
        `/connections/${encodeURIComponent(connection.id)}`,
        {
          label,
          endpoint: connection.provider === "ollama" ? endpoint || null : null,
          enabled,
          daily_calls: dailyCalls,
          daily_tokens: dailyTokens,
          max_concurrent: maxConcurrent,
          expected_revision: connection.revision,
        },
        "PATCH",
      );
      refresh();
    } catch (error) {
      reportFailure(error);
    } finally {
      setBusy(false);
    }
  }

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
      refresh();
    } catch (error) {
      reportFailure(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center gap-1 text-sm text-white/70 hover:text-white"
      >
        {open ? (
          <ChevronDown aria-hidden="true" className="size-4" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-4" />
        )}
        Settings
      </button>
      {open ? (
        <div id={contentId} className="mt-3 space-y-4">
          <form
            onSubmit={(event) => void saveSettings(event)}
            className="flex flex-wrap gap-3"
          >
            <label className="space-y-1 text-sm text-white/70">
              Name
              <Input
                required
                maxLength={200}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            {connection.provider === "ollama" ? (
              <label className="space-y-1 text-sm text-white/70">
                Endpoint
                <Input
                  type="url"
                  required
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                />
              </label>
            ) : null}
            <label className="space-y-1 text-sm text-white/70">
              Daily calls
              <Input
                type="number"
                min={1}
                max={100000}
                required
                value={dailyCalls}
                onChange={(event) => setDailyCalls(event.target.valueAsNumber)}
              />
            </label>
            <label className="space-y-1 text-sm text-white/70">
              Daily tokens
              <Input
                type="number"
                min={1}
                max={1000000000}
                required
                value={dailyTokens}
                onChange={(event) => setDailyTokens(event.target.valueAsNumber)}
              />
            </label>
            <label className="space-y-1 text-sm text-white/70">
              At a time
              <Input
                type="number"
                min={1}
                max={8}
                required
                value={maxConcurrent}
                onChange={(event) =>
                  setMaxConcurrent(event.target.valueAsNumber)
                }
              />
            </label>
            <label className="flex items-center gap-2 self-end pb-1 text-sm text-white/70">
              <Switch
                aria-label="Connection enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
              Enabled
            </label>
            <Button type="submit" disabled={busy}>
              Save settings
            </Button>
          </form>
          <form
            onSubmit={(event) => void addModel(event)}
            className="flex flex-wrap items-end gap-2"
          >
            <label className="space-y-1 text-sm text-white/70">
              Model ID
              <Input
                aria-label="Model ID"
                required
                maxLength={200}
                value={modelId}
                onChange={(event) => setModelId(event.target.value)}
              />
            </label>
            <Button type="submit" disabled={busy || !modelId}>
              Add model
            </Button>
          </form>
          <p className="text-xs text-white/45">
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

  const [job, setJob] = useState<Enqueued | null>(null);
  const [refreshBusy, setRefreshBusy] = useState(false);

  async function refreshModels() {
    setRefreshBusy(true);
    try {
      const result = await writeAI<Enqueued>(
        `/connections/${encodeURIComponent(connection.id)}/refresh`,
        { expected_revision: connection.revision },
      );
      setJob((current) => (result.task_id ? result : (current ?? result)));
    } catch (error) {
      reportFailure(error);
    } finally {
      setRefreshBusy(false);
    }
  }

  return (
    <article
      aria-label={name}
      className="space-y-3 rounded-md border border-white/10 bg-white/[0.02] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium text-white">{name}</h3>
          <p className="text-sm text-white/50">
            {providerLabel(connection.provider)}
          </p>
        </div>
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
      </div>

      <div className="space-y-1 text-sm text-white/70">
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
            job={job}
            kind="refresh"
            onComplete={() => {
              setJob(null);
              refresh();
            }}
          />
        </div>
      ) : null}

      {connection.read_only ? (
        <p className="text-sm text-white/60">
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
