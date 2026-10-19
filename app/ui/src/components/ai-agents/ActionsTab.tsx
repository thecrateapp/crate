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
const relatedEngines = [
  {
    name: "Tesseract OCR",
    state: "Unknown availability, version and languages",
    description: "Local OCR; no LLM provider or reasoning.",
    path: "/upcoming",
    link: "Show imports",
    capability: "curation.shows.write",
  },
  {
    name: "PANNs CNN14",
    state: "Unknown worker readiness, version and provenance",
    description: "Audio tagging; independent of LLM profiles.",
    path: "/analysis",
    link: "Audio analysis",
    capability: "library.analysis.manage",
  },
  {
    name: "Essentia / librosa",
    state: "Unknown worker readiness, versions and provenance",
    description: "Audio feature analysis; independent of LLM profiles.",
    path: "/analysis",
    link: "Audio features",
    capability: "library.analysis.manage",
  },
  {
    name: "Bliss",
    state: "Unknown vector readiness, version and fingerprints",
    description: "Audio similarity vectors; independent of LLM profiles.",
    path: "/analysis",
    link: "Similarity analysis",
    capability: "library.analysis.manage",
  },
  {
    name: "Playlist refinement heuristics",
    state: "Unknown runtime status",
    description:
      "Deterministic playlist refinement; no LLM model or reasoning.",
    path: "/playlists",
    link: "Playlists",
    capability: "curation.playlists.write",
  },
  {
    name: "Biography web search",
    state: "Unknown configured provider and credential availability",
    description:
      "Tavily, Brave and public-source fallback have separate dependencies and credentials. Search usage is separate from LLM tokens; results feed the biography action.",
    path: "/settings",
    link: "Search integrations",
    capability: "settings.manage",
  },
  {
    name: "Metadata enrichment",
    state: "Unknown integration and credential availability",
    description:
      "Last.fm, MusicBrainz, Spotify and other integrations retain their own credentials.",
    path: "/settings",
    link: "Enrichment settings",
    capability: "settings.manage",
  },
  {
    name: "External MCP clients",
    state: "Managed in client; model and reasoning unknown to Crate",
    description:
      "Read-only inventory. Crate manages principals, grants and activity; client models are configured externally.",
    path: "/agents/connections",
    link: "Agent connections",
    capability: "agents.integrations.manage",
  },
];
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
      <section className="space-y-3 rounded border border-border p-3 text-sm">
        <h3 className="font-medium">Engine inventory</h3>
        <p>
          Read-only inventory. Adapter support comes from this configuration
          snapshot; live readiness and related-engine telemetry are not
          included.
        </p>
        <div className="overflow-x-auto">
          <table aria-label="LLM adapters" className="w-full text-left">
            <thead>
              <tr>
                <th>Adapter</th>
                <th>Configuration support</th>
                <th>Live readiness</th>
              </tr>
            </thead>
            <tbody>
              {s.engines.map((engine) => (
                <tr className="border-t border-border" key={engine.provider}>
                  <td className="p-2">{engine.provider}</td>
                  <td className="p-2">
                    {engine.supported
                      ? "Supported adapter"
                      : "Unsupported adapter"}
                  </td>
                  <td className="p-2">
                    Unknown; inspect connection and catalog metadata under
                    Providers
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="overflow-x-auto">
          <table aria-label="Related engines" className="w-full text-left">
            <thead>
              <tr>
                <th>Engine</th>
                <th>Observed state</th>
                <th>Scope</th>
                <th>Where managed</th>
              </tr>
            </thead>
            <tbody>
              {relatedEngines.map((engine) => (
                <tr
                  className="border-t border-border align-top"
                  key={engine.name}
                >
                  <td className="p-2 font-medium">{engine.name}</td>
                  <td className="p-2">{engine.state}</td>
                  <td className="p-2">{engine.description}</td>
                  <td className="p-2">
                    {hasCapability(engine.capability) ? (
                      <Link className="text-primary underline" to={engine.path}>
                        {engine.link}
                      </Link>
                    ) : (
                      "Separate domain access required"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
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
