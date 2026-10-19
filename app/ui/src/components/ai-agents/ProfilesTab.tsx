import { useState, useEffect, useCallback, type FormEvent } from "react";
import { Button } from "@crate/ui/shadcn/button";
import { Input } from "@crate/ui/shadcn/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@crate/ui/shadcn/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { useApi } from "@/hooks/use-api";
import { AI_ROOT, JobStatus, reportFailure, writeAI } from "./api";
import {
  describeConfig,
  type Config,
  type Enqueued,
  type ModelsResponse,
  type Snapshot,
  type Version,
} from "./types";
const initial: Config = {
  reasoning: { mode: "provider_default", level: null, budget_tokens: null },
  image_detail: "default",
  timeout_seconds: 45,
  max_input_tokens: 16384,
  max_output_tokens: 2048,
};
function CatalogReader({
  connection,
  onData,
}: {
  connection: string;
  onData: (connection: string, data: ModelsResponse | null) => void;
}) {
  const { data } = useApi<ModelsResponse>(
    `${AI_ROOT}/connections/${encodeURIComponent(connection)}/models`,
  );
  useEffect(() => onData(connection, data), [connection, data, onData]);
  return null;
}
export function ProfilesTab({
  snapshot: s,
  refresh,
}: {
  snapshot: Snapshot;
  refresh: () => void;
}) {
  const { hasCapability } = useAuth();
  const manage = hasCapability("ai.config.manage");
  const tests = hasCapability("ai.tests.run");
  const [profile, setProfile] = useState("");
  const [expectedVersion, setExpectedVersion] = useState(0);
  const [probeKey, setProbeKey] = useState("");
  const [label, setLabel] = useState("");
  const [connection, setConnection] = useState("");
  const [modelId, setModelId] = useState("");
  const [config, setConfig] = useState<Config>(initial);
  const [reviewed, setReviewed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<Version | null>(null);
  const [job, setJob] = useState<Enqueued | null>(null);
  const [ack, setAck] = useState(false);
  const c = s.connections.find((c) => c.id === connection);
  const [loadedCatalog, setLoadedCatalog] = useState<{
    connection: string;
    data: ModelsResponse | null;
  } | null>(null);
  const receiveCatalog = useCallback(
    (connection: string, data: ModelsResponse | null) =>
      setLoadedCatalog({ connection, data }),
    [],
  );
  const catalog =
    loadedCatalog?.connection === connection ? loadedCatalog.data : null;
  const models =
    catalog?.models.filter(
      (m) => m.validated && m.structured_output && m.provider === c?.provider,
    ) ?? [];
  const model = models.find((m) => m.model_id === modelId);
  const selected = s.profiles.find((p) => p.id === profile);
  function chooseModel(value: string) {
    const next = models.find((m) => m.model_id === value);
    setModelId(value);
    setConfig({
      ...initial,
      image_detail: next?.image_details.includes("default")
        ? "default"
        : (next?.image_details[0] ?? "default"),
      max_output_tokens: Math.min(
        initial.max_output_tokens,
        next?.max_output_tokens ?? 16000,
      ),
      max_input_tokens: Math.min(
        initial.max_input_tokens,
        next?.context_window ?? 131072,
      ),
    });
    setReviewed(false);
  }
  function reasoning(mode: Config["reasoning"]["mode"]) {
    setConfig({
      ...config,
      reasoning: {
        mode,
        level: mode === "level" ? (model?.reasoning_levels[0] ?? null) : null,
        budget_tokens:
          mode === "budget" ? (model?.thinking_budget_min ?? null) : null,
      },
    });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!model || !c?.persistent_id || !reviewed) return;
    setBusy(true);
    try {
      const body = {
        connection_id: c.persistent_id,
        model_id: model.model_id,
        config,
      };
      if (selected)
        await writeAI(`/profiles/${selected.id}/versions`, {
          ...body,
          expected_version: expectedVersion,
        });
      else await writeAI("/profiles", { ...body, label });
      refresh();
    } catch (e) {
      reportFailure(e);
    } finally {
      setBusy(false);
    }
  }
  async function runTest() {
    if (!probe || !ack) return;
    setBusy(true);
    try {
      setJob(
        await writeAI<Enqueued>(
          `/profiles/${probe.profile_id}/versions/${probe.version}/test`,
          {
            expected_fingerprint: probe.fingerprint,
            acknowledged_billable: true,
            idempotency_key: probeKey,
          },
        ),
      );
      setProbe(null);
    } catch (e) {
      reportFailure(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      {connection ? (
        <CatalogReader
          key={connection}
          connection={connection}
          onData={receiveCatalog}
        />
      ) : null}
      <p>
        Profiles are immutable versions. Saving a new version does not change
        action bindings. Assign selected actions separately.
      </p>
      {s.profiles.map((p) => (
        <section
          key={p.id}
          className="rounded border border-border bg-card p-4"
        >
          <h3 className="font-medium">
            {p.label} · current version {p.current_version}
          </h3>
          {p.versions.map((v) => (
            <div key={v.version} className="my-2 text-sm">
              <p>
                v{v.version} · {v.model_id} · {describeConfig(v.config)}
              </p>
              {"kind" in v.config ? (
                <p>
                  Inherited snapshot for {v.config.action_id}. Create a bounded
                  profile for new assignments and tests.
                </p>
              ) : tests ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setAck(false);
                    setProbeKey(crypto.randomUUID());
                    setProbe(v);
                  }}
                >
                  Review billable test {p.label} v{v.version}
                </Button>
              ) : null}
            </div>
          ))}
        </section>
      ))}
      {manage ? (
        <form
          className="space-y-3 rounded border border-border p-4"
          onSubmit={(e) => void save(e)}
        >
          <h3 className="font-medium">Create profile or immutable version</h3>
          <label className="block">
            Profile
            <select
              className="min-h-9 max-w-full rounded-md border border-border bg-card px-2 text-sm"
              value={profile}
              onChange={(e) => {
                setProfile(e.target.value);
                setExpectedVersion(
                  s.profiles.find((p) => p.id === e.target.value)
                    ?.current_version ?? 0,
                );
                setConnection("");
                setModelId("");
                setConfig(initial);
                setReviewed(true);
              }}
            >
              <option value="">New profile</option>
              {s.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} (new version after v{p.current_version})
                </option>
              ))}
            </select>
          </label>
          {!profile ? (
            <label className="block">
              Profile label
              <Input
                required
                maxLength={200}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
          ) : null}
          <label className="block">
            Connection
            <select
              className="min-h-9 max-w-full rounded-md border border-border bg-card px-2 text-sm"
              aria-label="Connection"
              required
              value={connection}
              onChange={(e) => {
                setConnection(e.target.value);
                chooseModel("");
              }}
            >
              <option value="">Choose connection</option>
              {s.connections
                .filter((c) => c.enabled)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
            </select>
          </label>
          {c && !c.persistent_id ? (
            <p>
              Refresh this environment catalog first to register its connection
              identity. Environment credentials stay read-only.
            </p>
          ) : null}
          <label className="block">
            Model
            <select
              className="min-h-9 max-w-full rounded-md border border-border bg-card px-2 text-sm"
              aria-label="Model"
              required
              value={modelId}
              onChange={(e) => chooseModel(e.target.value)}
            >
              <option value="">Choose validated model</option>
              {models.map((m) => (
                <option key={m.model_id} value={m.model_id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          {catalog && catalog.status !== "ready" ? (
            <p>
              Catalog stale or unknown: {catalog.error_code ?? catalog.status}.
              Review the last validated entries or refresh under Providers.
            </p>
          ) : null}
          {model ? (
            <>
              <p className="text-sm">
                Modalities: {model.input_modalities.join(", ")} · context{" "}
                {model.context_window ?? "unknown"} · output limit{" "}
                {model.max_output_tokens ?? "unknown"}
              </p>
              <label className="block">
                Reasoning
                <select
                  className="min-h-9 max-w-full rounded-md border border-border bg-card px-2 text-sm"
                  aria-label="Reasoning"
                  value={config.reasoning.mode}
                  onChange={(e) =>
                    reasoning(e.target.value as Config["reasoning"]["mode"])
                  }
                >
                  <option value="provider_default">Provider default</option>
                  {model.reasoning_enabled ? (
                    <option value="enabled">Enabled</option>
                  ) : null}
                  {model.reasoning_disabled ? (
                    <option value="disabled">Disabled</option>
                  ) : null}
                  {model.reasoning_levels.length ? (
                    <option value="level">Native level</option>
                  ) : null}
                  {model.thinking_budget_min !== null &&
                  model.thinking_budget_max !== null ? (
                    <option value="budget">Thinking budget</option>
                  ) : null}
                </select>
              </label>
              {config.reasoning.mode === "level" ? (
                <label className="block">
                  Native level
                  <select
                    className="min-h-9 max-w-full rounded-md border border-border bg-card px-2 text-sm"
                    aria-label="Native level"
                    value={config.reasoning.level ?? ""}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        reasoning: {
                          ...config.reasoning,
                          level: e.target.value,
                        },
                      })
                    }
                  >
                    {model.reasoning_levels.map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {config.reasoning.mode === "budget" ? (
                <label className="block">
                  Thinking budget
                  <Input
                    aria-label="Thinking budget"
                    type="number"
                    required
                    min={model.thinking_budget_min ?? 0}
                    max={model.thinking_budget_max ?? 0}
                    value={config.reasoning.budget_tokens ?? ""}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        reasoning: {
                          ...config.reasoning,
                          budget_tokens: e.target.valueAsNumber,
                        },
                      })
                    }
                  />
                </label>
              ) : null}
              <label className="block">
                Image detail
                <select
                  className="min-h-9 max-w-full rounded-md border border-border bg-card px-2 text-sm"
                  aria-label="Image detail"
                  value={config.image_detail}
                  onChange={(e) =>
                    setConfig({ ...config, image_detail: e.target.value })
                  }
                >
                  {model.image_details.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-3">
                {(
                  [
                    ["timeout_seconds", "Timeout seconds", 90],
                    [
                      "max_output_tokens",
                      "Output tokens",
                      Math.min(16000, model.max_output_tokens ?? 16000),
                    ],
                    [
                      "max_input_tokens",
                      "Input tokens",
                      Math.min(131072, model.context_window ?? 131072),
                    ],
                  ] as const
                ).map(([key, title, max]) => (
                  <label key={key}>
                    {title}
                    <Input
                      type="number"
                      required
                      min={1}
                      max={max}
                      value={config[key]}
                      onChange={(e) =>
                        setConfig({ ...config, [key]: e.target.valueAsNumber })
                      }
                    />
                  </label>
                ))}
              </div>
              {!reviewed ? (
                <p>
                  Model changed; review the reset reasoning, detail and limits
                  before saving.
                </p>
              ) : null}
              <label className="block">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />{" "}
                I reviewed this model's native options and limits
              </label>
            </>
          ) : null}
          <Button
            type="submit"
            disabled={busy || !model || !c?.persistent_id || !reviewed}
          >
            {selected ? "Save new version" : "Create profile"}
          </Button>
        </form>
      ) : null}
      <Dialog
        open={probe !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setProbe(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm billable compatibility test</DialogTitle>
            <DialogDescription>
              One synthetic model call, using this exact profile. No source is
              sent. No automatic retries or fallback.
            </DialogDescription>
          </DialogHeader>
          {probe && !("kind" in probe.config) ? (
            <p>
              {probe.model_id} · {describeConfig(probe.config)} · input maximum{" "}
              {probe.config.max_input_tokens} tokens
            </p>
          ) : null}
          <label>
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
            />{" "}
            I acknowledge this call may be billed
          </label>
          <Button disabled={!ack || busy} onClick={() => void runTest()}>
            Run one billable test
          </Button>
        </DialogContent>
      </Dialog>
      <JobStatus job={job} onComplete={refresh} />
    </div>
  );
}
