import { useState, type FormEvent } from "react";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import type { Connection, Enqueued, ModelsResponse, Snapshot } from "./types";
import { AI_ROOT, JobStatus, reportFailure, writeAI } from "./api";
function ConnectionCard({
  connection: c,
  refresh,
}: {
  connection: Connection;
  refresh: () => void;
}) {
  const { hasCapability } = useAuth();
  const manage = hasCapability("ai.config.manage");
  const credentials = hasCapability("ai.credentials.manage");
  const [key, setKey] = useState("");
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Enqueued | null>(null);
  const { data: catalog, refetch } = useApi<ModelsResponse>(
    `${AI_ROOT}/connections/${encodeURIComponent(c.id)}/models`,
  );
  async function mutate(
    path: string,
    body: unknown,
    method: "POST" | "PATCH" = "POST",
  ) {
    setBusy(true);
    try {
      const result = await writeAI<Enqueued>(path, body, method);
      if (path.endsWith("/refresh"))
        setJob((current) => (result.task_id ? result : (current ?? result)));
      refresh();
      refetch();
      return true;
    } catch (e) {
      reportFailure(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function credential(value: string | null) {
    try {
      await mutate(`/connections/${c.id}/credential`, {
        api_key: value,
        expected_revision: c.revision,
      });
    } finally {
      setKey("");
    }
  }
  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h3 className="font-medium">
        {c.label} · {c.provider}
      </h3>
      <p className="text-sm">
        {c.enabled ? "Enabled" : "Disabled"} · key source: {c.source} ·{" "}
        {c.has_key ? "key present" : "no key"} ·{" "}
        {c.endpoint ?? "Provider endpoint"}
      </p>
      <p className="text-sm">
        Catalog: {catalog?.status ?? c.catalog_status} · last verification:{" "}
        {catalog?.updated_at ?? c.catalog_updated_at ?? "unknown"} ·{" "}
        {catalog?.error_code ?? c.catalog_error_code}
        {(catalog?.status ?? c.catalog_status) !== "ready"
          ? " · stale or unknown capabilities; refresh explicitly"
          : ""}
      </p>
      <details>
        <summary>Available models ({c.model_count})</summary>
        {catalog?.models.map((m) => (
          <p key={m.model_id}>
            {m.model_id} ·{" "}
            {m.validated ? "validated" : "pending, cannot assign"} ·{" "}
            {m.input_modalities.join(", ")} · structured output{" "}
            {m.structured_output ? "yes" : "no"}
          </p>
        ))}
      </details>
      <p className="text-xs">
        Quota: {c.daily_calls} calls/day · {c.daily_tokens} tokens/day ·{" "}
        {c.max_concurrent} concurrent
      </p>
      {c.read_only ? (
        <p>
          Environment connection is read-only. Its key is never copied into
          Admin.
        </p>
      ) : (
        <>
          {manage ? (
            <ConnectionEditor
              key={c.revision}
              connection={c}
              busy={busy}
              save={(body) =>
                mutate(
                  `/connections/${c.id}`,
                  { ...body, expected_revision: c.revision },
                  "PATCH",
                )
              }
            />
          ) : null}
          {credentials ? (
            <div className="flex flex-wrap items-end gap-2">
              <label>
                New API key
                <Input
                  type="password"
                  aria-label="New API key"
                  autoComplete="new-password"
                  maxLength={4096}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
              </label>
              <Button
                disabled={busy || !key}
                onClick={() => void credential(key)}
              >
                Rotate key
              </Button>
              <Button
                variant="outline"
                disabled={busy || !c.has_key}
                onClick={() => void credential(null)}
              >
                Revoke key
              </Button>
            </div>
          ) : null}
          {manage ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(`/connections/${c.id}/models`, {
                  model_id: manual,
                  expected_revision: c.revision,
                }).then((ok) => {
                  if (ok) setManual("");
                });
              }}
            >
              <label>
                Manual model ID
                <Input
                  required
                  maxLength={200}
                  pattern="[A-Za-z0-9][A-Za-z0-9._:/-]*"
                  value={manual}
                  onChange={(e) => setManual(e.target.value)}
                />
              </label>
              <Button type="submit" disabled={busy || !manual}>
                Register pending model
              </Button>
              <p className="text-xs">
                Manual IDs remain pending until trusted capabilities and
                compatibility are validated.
              </p>
            </form>
          ) : null}
        </>
      )}
      {manage ? (
        <Button
          variant="outline"
          disabled={busy}
          aria-label={`Refresh catalog ${c.label}`}
          onClick={() =>
            void mutate(`/connections/${encodeURIComponent(c.id)}/refresh`, {
              expected_revision: c.revision,
            })
          }
        >
          Refresh catalog
        </Button>
      ) : null}
      <JobStatus
        job={job}
        onComplete={() => {
          refresh();
          refetch();
        }}
      />
    </section>
  );
}
function ConnectionEditor({
  connection: c,
  busy,
  save,
}: {
  connection: Connection;
  busy: boolean;
  save: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [label, setLabel] = useState(c.label);
  const [endpoint, setEndpoint] = useState(c.endpoint ?? "");
  const [enabled, setEnabled] = useState(c.enabled);
  const [calls, setCalls] = useState(c.daily_calls);
  const [tokens, setTokens] = useState(c.daily_tokens);
  const [concurrent, setConcurrent] = useState(c.max_concurrent);
  return (
    <form
      className="flex flex-wrap gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save({
          label,
          endpoint: endpoint || null,
          enabled,
          daily_calls: calls,
          daily_tokens: tokens,
          max_concurrent: concurrent,
        });
      }}
    >
      <label>
        Connection label
        <Input
          required
          maxLength={200}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      {c.provider === "ollama" ? (
        <label>
          Ollama endpoint
          <Input
            type="url"
            required
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
          />
        </label>
      ) : null}
      <label>
        Daily calls
        <Input
          type="number"
          min={1}
          max={100000}
          required
          value={calls}
          onChange={(e) => setCalls(e.target.valueAsNumber)}
        />
      </label>
      <label>
        Daily tokens
        <Input
          type="number"
          min={1}
          max={1000000000}
          required
          value={tokens}
          onChange={(e) => setTokens(e.target.valueAsNumber)}
        />
      </label>
      <label>
        Concurrency
        <Input
          type="number"
          min={1}
          max={8}
          required
          value={concurrent}
          onChange={(e) => setConcurrent(e.target.valueAsNumber)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />{" "}
        Enabled
      </label>
      <Button type="submit" disabled={busy}>
        Save connection
      </Button>
    </form>
  );
}
export function ProvidersTab({
  snapshot,
  refresh,
}: {
  snapshot: Snapshot;
  refresh: () => void;
}) {
  const manage = useAuth().hasCapability("ai.config.manage");
  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState("gemini");
  const [endpoint, setEndpoint] = useState("");
  const [busy, setBusy] = useState(false);
  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await writeAI("/connections", {
        label,
        provider,
        endpoint: provider === "ollama" ? endpoint : null,
      });
      setLabel("");
      refresh();
    } catch (e) {
      reportFailure(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <p>
        Catalog refresh discovers models without inference. Billable
        compatibility tests are a separate explicit action under profiles.
      </p>
      {snapshot.connections.map((c) => (
        <ConnectionCard key={c.id} connection={c} refresh={refresh} />
      ))}
      {manage ? (
        <form
          className="flex flex-wrap items-end gap-3 rounded border border-border p-4"
          onSubmit={(e) => void create(e)}
        >
          <label>
            New connection label
            <Input
              required
              maxLength={200}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label>
            Provider
            <select
              className="min-h-9 max-w-full rounded-md border border-border bg-card px-2 text-sm"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              {snapshot.engines
                .filter((e) => e.supported)
                .map((e) => (
                  <option key={e.provider}>{e.provider}</option>
                ))}
            </select>
          </label>
          {provider === "ollama" ? (
            <label>
              Endpoint
              <Input
                type="url"
                required
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
              />
            </label>
          ) : null}
          <Button type="submit" disabled={busy}>
            Add connection
          </Button>
        </form>
      ) : null}
    </div>
  );
}
