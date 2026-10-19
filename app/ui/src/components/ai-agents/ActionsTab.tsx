import { useState } from "react";
import { Link } from "react-router";
import { Button } from "@crate/ui/shadcn/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@crate/ui/shadcn/dialog";
import { useApi } from "@/hooks/use-api";
import { useAuth } from "@/contexts/AuthContext";
import {
  describeConfig,
  type Snapshot,
  type Binding,
  type Activity,
} from "./types";
import { writeAI, reportFailure } from "./api";
export function ActionsTab({
  snapshot: s,
  refresh,
}: {
  snapshot: Snapshot;
  refresh: () => void;
}) {
  const { hasCapability } = useAuth();
  const manage = hasCapability("ai.config.manage");
  const { data: activity } = useApi<Activity>(
    hasCapability("ai.usage.read") ? "/api/admin/ai/activity?limit=50" : null,
  );
  const [group, setGroup] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [disabled, setDisabled] = useState<string[]>([]);
  const [review, setReview] = useState<"bindings" | "activate" | null>(null);
  const [reviewSnapshot, setReviewSnapshot] = useState(s);
  const [reviewBody, setReviewBody] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const versions = s.profiles.flatMap((p) =>
    p.versions.map((v) => ({ p, v, key: `${p.id}:${v.version}` })),
  );
  const changes: Omit<Binding, "revision">[] = selected.flatMap((action_id) => {
    const choice = versions.find((v) => v.key === draft[action_id]);
    return choice
      ? [
          {
            action_id,
            profile_id: choice.p.id,
            profile_version: choice.v.version,
            enabled: !disabled.includes(action_id),
          },
        ]
      : [];
  });
  function openReview(kind: "bindings" | "activate") {
    setReviewSnapshot(s);
    setReviewBody(
      kind === "activate"
        ? {
            expected_revision: s.revision,
            expected_review_fingerprint: s.review_fingerprint,
          }
        : {
            changes: changes.map((c) => ({
              ...c,
              expected_revision:
                s.bindings.find((b) => b.action_id === c.action_id)?.revision ??
                0,
            })),
          },
    );
    setReview(kind);
  }
  async function save() {
    setBusy(true);
    try {
      if (review === "activate") await writeAI("/activate", reviewBody);
      else await writeAI("/bindings", reviewBody);
      setReview(null);
      setSelected([]);
      refresh();
    } catch (e) {
      reportFailure(e);
      setReview(null);
      refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <p>
        {s.migrated
          ? "Action bindings are active. Global LLM settings do not reassign these actions."
          : "Legacy routing is active. Prepared assignments take effect only after explicit migration."}
      </p>
      <label>
        Filter group{" "}
        <select
          className="min-h-9 max-w-full rounded-md border border-border bg-card px-2 text-sm"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
        >
          <option value="">All groups</option>
          {[...new Set(s.actions.map((a) => a.group))].map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </label>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>Action and data sent</th>
              <th>Effective routing</th>
              <th>Prepared assignment</th>
              <th>Last result</th>
            </tr>
          </thead>
          <tbody>
            {s.actions
              .filter((a) => !group || a.group === group)
              .map((a) => {
                const binding = s.bindings.find((b) => b.action_id === a.id);
                const version = versions.find(
                  (v) =>
                    v.p.id === binding?.profile_id &&
                    v.v.version === binding?.profile_version,
                );
                const legacy = s.legacy_actions.find(
                  (l) => l.action_id === a.id,
                );
                return (
                  <tr key={a.id} className="border-t border-border align-top">
                    <td className="p-3">
                      <strong>{a.label}</strong>
                      <p>{a.description}</p>
                      <p>
                        {a.input} · {a.maxima.timeout_seconds}s maximum ·{" "}
                        {a.maxima.max_output_tokens} output tokens
                      </p>
                      <Link className="text-primary underline" to={a.location}>
                        Where used
                      </Link>
                    </td>
                    <td className="p-3">
                      {s.migrated ? (
                        <>
                          <p>
                            {binding?.enabled
                              ? "Configured"
                              : "Disabled / unavailable"}
                          </p>
                          {version ? (
                            <>
                              <p>
                                {version.p.label} v{version.v.version} ·{" "}
                                {version.v.model_id}
                              </p>
                              <p>{describeConfig(version.v.config)}</p>
                            </>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <p>
                            Current: {legacy?.legacy_model ?? "unavailable"}
                          </p>
                          <p>
                            {legacy?.supported
                              ? "Inherited"
                              : "Unsupported inherited provider"}{" "}
                            · native output{" "}
                            {legacy?.legacy_options.max_tokens ??
                              "provider default"}{" "}
                            · timeout{" "}
                            {legacy?.effective_timeout_seconds ??
                              "provider default"}{" "}
                            · detail{" "}
                            {legacy?.legacy_options.image_detail ?? "default"}
                          </p>
                        </>
                      )}
                    </td>
                    <td className="space-y-2 p-3">
                      {version ? (
                        <p>
                          {s.migrated ? "Assigned" : "Pending"}:{" "}
                          {version.p.label} v{version.v.version} (
                          {binding?.enabled ? "enabled" : "disabled"})
                        </p>
                      ) : null}
                      {manage ? (
                        <>
                          <label className="block">
                            <input
                              type="checkbox"
                              aria-label={`Select ${a.label}`}
                              checked={selected.includes(a.id)}
                              onChange={(e) =>
                                setSelected((x) =>
                                  e.target.checked
                                    ? [...x, a.id]
                                    : x.filter((id) => id !== a.id),
                                )
                              }
                            />{" "}
                            Select
                          </label>
                          <select
                            className="min-h-9 max-w-full rounded-md border border-border bg-card px-2 text-sm"
                            aria-label={`Profile version for ${a.label}`}
                            value={draft[a.id] ?? ""}
                            onChange={(e) =>
                              setDraft({ ...draft, [a.id]: e.target.value })
                            }
                          >
                            <option value="">Choose profile version</option>
                            {versions
                              .filter(
                                ({ v }) =>
                                  !("kind" in v.config) ||
                                  v.config.action_id === a.id,
                              )
                              .map(({ p, v, key }) => (
                                <option key={key} value={key}>
                                  {p.label} v{v.version} · {v.model_id}
                                </option>
                              ))}
                          </select>
                          <label className="block">
                            <input
                              type="checkbox"
                              checked={!disabled.includes(a.id)}
                              onChange={(e) =>
                                setDisabled((x) =>
                                  e.target.checked
                                    ? x.filter((id) => id !== a.id)
                                    : [...x, a.id],
                                )
                              }
                            />{" "}
                            Enable assignment
                          </label>
                        </>
                      ) : null}
                    </td>
                    <td className="p-3">
                      {hasCapability("ai.usage.read")
                        ? (activity?.items.find((i) => i.action_id === a.id)
                            ?.status ?? "No result in recent metadata")
                        : "Usage permission required"}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <div className="rounded border border-border p-3 text-sm">
        <h3 className="font-medium">Other engines</h3>
        <p>
          Local OCR, deterministic Music Paths and acoustic analysis run
          independently of LLM profiles. External MCP services are managed in
          their own integration settings.
        </p>
      </div>
      {manage ? (
        <div className="flex gap-2">
          <Button
            disabled={
              !changes.length || changes.length !== selected.length || busy
            }
            onClick={() => openReview("bindings")}
          >
            Review assignments
          </Button>
          {!s.migrated ? (
            <Button variant="outline" onClick={() => openReview("activate")}>
              Review migration
            </Button>
          ) : null}
        </div>
      ) : null}
      <Dialog
        open={review !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setReview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {review === "activate"
                ? "Activate reviewed AI routing"
                : "Apply selected assignments"}
            </DialogTitle>
            <DialogDescription>
              {review === "activate"
                ? "Activation captures inherited options and enables connection quotas. Native context or output limits may exceed daily token allowance; choose bounded profiles or adjust connection quotas first. Unknown inherited limits prevent activation."
                : "These selected actions change together. Concurrent changes reject the entire batch. Existing accepted work may stop if its reviewed configuration changes."}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-auto text-sm">
            {review === "activate"
              ? reviewSnapshot.actions.map((a) => {
                  const b = reviewSnapshot.bindings.find(
                    (x) => x.action_id === a.id,
                  );
                  const p = reviewSnapshot.profiles.find(
                    (x) => x.id === b?.profile_id,
                  );
                  const v = p?.versions.find(
                    (x) => x.version === b?.profile_version,
                  );
                  return (
                    <p key={a.id}>
                      {a.label}:{" "}
                      {v
                        ? `${p?.label} v${v.version} · ${b?.enabled ? "enabled" : "disabled"}`
                        : (reviewSnapshot.legacy_actions.find(
                            (l) => l.action_id === a.id,
                          )?.legacy_model ?? "unavailable")}
                    </p>
                  );
                })
              : changes.map((c) => (
                  <p key={c.action_id}>
                    {s.actions.find((a) => a.id === c.action_id)?.label}:{" "}
                    {
                      versions.find(
                        (v) =>
                          v.p.id === c.profile_id &&
                          v.v.version === c.profile_version,
                      )?.p.label
                    }{" "}
                    v{c.profile_version} · {c.enabled ? "enabled" : "disabled"}
                    {!s.migrated ? " (pending migration)" : ""}
                  </p>
                ))}
          </div>
          <Button disabled={busy} onClick={() => void save()}>
            {review === "activate"
              ? "Confirm activation"
              : "Confirm assignments"}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setReview(null)}
          >
            Cancel
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
