import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@crate/ui/shadcn/button";
import { useApi } from "@/hooks/use-api";
import { useAuth } from "@/contexts/AuthContext";
import type { Activity, Snapshot, Usage } from "./types";
import { AI_ROOT } from "./api";
export function ActivityTab({ snapshot: s }: { snapshot: Snapshot }) {
  const [filters, setFilters] = useState({
    action_id: "",
    provider: "",
    model_id: "",
    connection_id: "",
  });
  const [cursors, setCursors] = useState<string[]>([]);
  const query = new URLSearchParams({ limit: "50" });
  if (cursors.length) query.set("cursor", cursors[cursors.length - 1]!);
  for (const [key, value] of Object.entries(filters))
    if (value) query.set(key, value);
  const { data: usage, error: usageError } = useApi<Usage>(`${AI_ROOT}/usage`);
  function filter(key: keyof typeof filters, value: string) {
    setFilters({ ...filters, [key]: value });
    setCursors([]);
  }
  return (
    <div className="space-y-4">
      <p>
        Private invocation metadata · history retained for 90 days · 50 rows per
        page. Tokens and monetary estimates can be unknown.
      </p>
      {usage ? (
        <div className="rounded border border-border p-4">
          <p>
            {usage.totals.calls} calls · {usage.totals.tokens} charged tokens ·{" "}
            {usage.totals.failed} failures · {usage.totals.unknown_calls} calls
            with unknown usage
          </p>
          <p>
            Cost:{" "}
            {usage.totals.estimated_cost == null ||
            usage.totals.unknown_calls > 0 ||
            usage.legacy_usage_unknown
              ? "unknown"
              : `estimated ${usage.totals.estimated_cost}`}
          </p>
          {usage.legacy_usage_unknown ? (
            <p>
              Historical legacy usage is unknown. Legacy tracking did not
              enforce the new quotas.
            </p>
          ) : null}
          {usage.truncated ? (
            <p>
              Daily history is truncated; totals cover the full available
              period.
            </p>
          ) : null}
        </div>
      ) : null}
      {usageError ? <p role="alert">{usageError}</p> : null}
      <div className="flex flex-wrap gap-3">
        <label>
          Action
          <select
            className="min-h-9 max-w-full rounded-md border border-border bg-card px-2 text-sm"
            value={filters.action_id}
            onChange={(e) => filter("action_id", e.target.value)}
          >
            <option value="">All actions</option>
            {s.actions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Provider
          <select
            className="min-h-9 max-w-full rounded-md border border-border bg-card px-2 text-sm"
            value={filters.provider}
            onChange={(e) => filter("provider", e.target.value)}
          >
            <option value="">All providers</option>
            {s.engines.map((e) => (
              <option key={e.provider}>{e.provider}</option>
            ))}
          </select>
        </label>
        <label>
          Connection
          <select
            className="min-h-9 max-w-full rounded-md border border-border bg-card px-2 text-sm"
            value={filters.connection_id}
            onChange={(e) => filter("connection_id", e.target.value)}
          >
            <option value="">All connections</option>
            {s.connections
              .filter((c) => c.persistent_id)
              .map((c) => (
                <option key={c.id} value={c.persistent_id!}>
                  {c.label}
                </option>
              ))}
          </select>
        </label>
        <label>
          Model ID
          <input
            className="rounded border border-border bg-card p-1"
            maxLength={200}
            value={filters.model_id}
            onChange={(e) => filter("model_id", e.target.value)}
          />
        </label>
      </div>
      <ActivityPage
        key={query.toString()}
        query={query.toString()}
        hasPrevious={cursors.length > 0}
        previous={() => setCursors((x) => x.slice(0, -1))}
        next={(cursor) => setCursors((x) => [...x, cursor])}
      />
    </div>
  );
}

function ActivityPage({
  query,
  hasPrevious,
  previous,
  next,
}: {
  query: string;
  hasPrevious: boolean;
  previous: () => void;
  next: (cursor: string) => void;
}) {
  const auth = useAuth();
  const { data, error, loading } = useApi<Activity>(
    `${AI_ROOT}/activity?${query}`,
  );
  return (
    <>
      {error ? <p role="alert">{error}</p> : null}
      <div className="overflow-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>Invocation</th>
              <th>Tokens</th>
              <th>Outcome</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((i) => (
              <tr key={i.id} className="border-t border-border">
                <td className="p-3">
                  {i.action_id ?? "Synthetic probe"}
                  <p>
                    {i.model_id} · {i.profile_id ?? "legacy"} v
                    {i.profile_version ?? "—"}
                  </p>
                  <p>
                    {i.created_at} · actor {i.actor_id ?? "system"}
                  </p>
                  {i.job_id ? (
                    <span>
                      Job{" "}
                      {auth.hasCapability("ops.tasks.manage") ? (
                        <Link
                          className="text-primary underline"
                          to={`/tasks?task_id=${encodeURIComponent(i.job_id)}`}
                        >
                          {i.job_id}
                        </Link>
                      ) : (
                        i.job_id
                      )}
                    </span>
                  ) : null}
                </td>
                <td className="p-3">
                  <p>
                    Input {i.input_tokens ?? "unknown"} · output{" "}
                    {i.output_tokens ?? "unknown"}
                  </p>
                  <p>
                    Thinking {i.thought_tokens ?? "unknown"} · cached{" "}
                    {i.cached_input_tokens ?? "unknown"} · total{" "}
                    {i.total_tokens ?? "unknown"}
                  </p>
                  <p>
                    Charged {i.charged_tokens} · reserved {i.reserved_tokens} ·{" "}
                    {i.metering_mode}
                  </p>
                </td>
                <td className="p-3">
                  {i.status} · {i.duration_ms}ms<p>{i.error_code}</p>
                  <p>
                    Cost:{" "}
                    {i.estimated_cost == null || !i.usage_known
                      ? "unknown"
                      : `estimated ${i.estimated_cost}`}
                  </p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading ? <p>Loading activity…</p> : null}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={!hasPrevious || loading}
          onClick={previous}
        >
          Previous page
        </Button>
        <Button
          disabled={!data?.next_cursor || loading}
          onClick={() => {
            if (data?.next_cursor) next(data.next_cursor);
          }}
        >
          Next page
        </Button>
      </div>
    </>
  );
}
