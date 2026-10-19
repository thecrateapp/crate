import type { AgentPlan } from "./agent-integrations";

export const operationCapabilities: Record<string, string> = {
  shows_import: "curation.shows.write",
  editorial_change: "curation.playlists.write",
  job_retry: "ops.tasks.manage",
  job_cancel: "ops.tasks.manage",
  schedule_run: "ops.tasks.manage",
  schedule_update: "ops.tasks.manage",
  runtime_update: "ops.runtime.manage",
  repair_photo_flag: "library.repair.run",
  health_check: "library.repair.run",
  quality_check: "library.repair.run",
  repairs: "library.repair.run",
  metadata_update: "library.metadata.write",
  enrichment: "library.metadata.write",
  analysis: "library.analysis.manage",
  library_sync: "library.metadata.write",
  metadata_export: "library.metadata.write",
  metadata_rehydrate: "library.metadata.write",
};

export const targetIdentity = (target: {
  entity_uid?: unknown;
  artist_uid?: unknown;
  entity_type?: unknown;
  name?: unknown;
  scope?: unknown;
}) => {
  const uid = target.entity_uid ?? target.artist_uid;
  if (typeof uid === "string" && uid) return uid;
  if (target.entity_type === "library" && target.scope === "global")
    return "library:global";
  if (
    ["show", "playlist", "task", "schedule", "runtime"].includes(
      String(target.entity_type),
    ) &&
    typeof target.name === "string" &&
    target.name
  )
    return `${target.entity_type}:${target.name}`;
  return null;
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonemptyText = (value: unknown) =>
  typeof value === "string" && value.length > 0;
const nullableText = (value: unknown) =>
  value === null || typeof value === "string";
const nullableCount = (value: unknown) =>
  value === null || (Number.isInteger(value) && Number(value) >= 0);

export function completeEditorialContent(item: AgentPlan) {
  const { metadata, selection, smart_rules: rules } = item;
  const policyOnly =
    item.kind === "visibility" || item.kind === "refresh_policy";
  if (
    ![
      "create",
      "duplicate",
      "edit",
      "refine",
      "regenerate",
      "visibility",
      "refresh_policy",
    ].includes(item.kind ?? "") ||
    !isRecord(metadata) ||
    !nonemptyText(metadata.name) ||
    typeof metadata.description !== "string" ||
    !nonemptyText(metadata.scope) ||
    !nonemptyText(metadata.visibility) ||
    !["static", "smart"].includes(String(metadata.generation_mode)) ||
    typeof metadata.is_active !== "boolean" ||
    typeof metadata.auto_refresh_enabled !== "boolean" ||
    !Array.isArray(selection) ||
    selection.length > 100 ||
    !nullableCount(item.source_revision) ||
    !nullableCount(item.generation_epoch) ||
    !isRecord(item.provenance) ||
    !nonemptyText(item.provenance.source) ||
    !nonemptyText(item.provenance.actor_principal_id) ||
    !nonemptyText(item.provenance.prepared_by)
  )
    return false;

  // Policy changes intentionally omit the existing selection. Legacy smart
  // rules may also be null; the compiler does not regenerate them in this case.
  if (
    metadata.generation_mode === "static"
      ? rules !== null
      : !(isRecord(rules) && (policyOnly || Object.keys(rules).length > 0)) &&
        !(policyOnly && rules === null)
  )
    return false;

  const summary = item.changes[0];
  if (
    item.changes.length !== 1 ||
    !summary ||
    summary.field !== "playlist" ||
    summary.kind !== item.kind ||
    !Number.isInteger(summary.track_count) ||
    Number(summary.track_count) < 0 ||
    summary.track_count !== item.impact.track_count ||
    (policyOnly
      ? selection.length !== 0
      : selection.length !== summary.track_count) ||
    (
      ["name", "description", "scope", "visibility", "generation_mode"] as const
    ).some((key) => summary[key] !== metadata[key]) ||
    summary.is_active_after !== metadata.is_active ||
    summary.auto_refresh_after !== metadata.auto_refresh_enabled
  )
    return false;

  if (
    !Array.isArray(item.new_exclusions) ||
    item.new_exclusions.length > 100 ||
    !item.new_exclusions.every(nonemptyText) ||
    ![item.existing_exclusions, item.copied_exclusions].every(
      (exclusions) =>
        Array.isArray(exclusions) &&
        exclusions.length <= 100 &&
        exclusions.every(
          (excluded) =>
            isRecord(excluded) &&
            nullableText(excluded.track_uid) &&
            nullableText(excluded.global_track_uid) &&
            (nonemptyText(excluded.track_uid) ||
              nonemptyText(excluded.global_track_uid)),
        ),
    )
  )
    return false;

  const localUids = selection.flatMap((track) =>
    isRecord(track) && nonemptyText(track.track_uid) ? [track.track_uid] : [],
  );
  return (
    new Set(localUids).size === localUids.length &&
    selection.every(
      (track, index) =>
        isRecord(track) &&
        nullableCount(track.row_id) &&
        nullableText(track.track_uid) &&
        nullableText(track.global_track_uid) &&
        (nonemptyText(track.track_uid) ||
          nonemptyText(track.global_track_uid)) &&
        nullableText(track.title) &&
        nullableText(track.artist) &&
        nullableText(track.album) &&
        (track.duration === null ||
          (typeof track.duration === "number" &&
            Number.isFinite(track.duration) &&
            track.duration >= 0)) &&
        track.position === index + 1 &&
        nonemptyText(track.source) &&
        typeof track.locked === "boolean",
    )
  );
}

/**
 * The exact-change safety gate: approval and rejection are only enabled once
 * the full set of targets and changes for a plan has round-tripped intact.
 */
export function planIsComplete(item: AgentPlan): boolean {
  const identities = item.targets.map(targetIdentity);
  const identitySet = new Set(identities);
  return (
    !item.truncated &&
    item.target_count > 0 &&
    item.returned_count === item.target_count &&
    item.targets.length === item.target_count &&
    identities.every(Boolean) &&
    identitySet.size === item.target_count &&
    item.changes.length > 0 &&
    item.changes.every((change) => {
      const uid = change.entity_uid ?? change.artist_uid;
      if (typeof uid === "string") return identitySet.has(uid);
      const exactIdentity = targetIdentity(change);
      if (exactIdentity) return identitySet.has(exactIdentity);
      if (Array.isArray(change.targets) && change.targets.length > 0)
        return change.targets.every(
          (target) =>
            target &&
            typeof target === "object" &&
            identitySet.has(targetIdentity(target)),
        );
      return change.scope === "global" && identitySet.has("library:global");
    }) &&
    (item.operation !== "editorial_change" || completeEditorialContent(item))
  );
}

/** Identifies the exact reviewed version of a plan: any change invalidates it. */
export function reviewIdentity(item: AgentPlan): string {
  return [
    item.plan_id,
    item.plan_version,
    item.content_hash,
    item.authorization_context_hash,
    item.policy_revision,
  ].join("/");
}
