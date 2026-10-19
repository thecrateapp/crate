import { humanizeKey } from "./humanize";
import type { AgentPlan } from "./agent-integrations";
import { fieldDiff, type FieldDiffRow } from "./agent-plan-presentation";
import { isRecord, targetIdentity } from "./agent-plan-review";

/** Shown where a value was moved into Technical details. */
export const TECHNICAL_PLACEHOLDER = "Listed in technical details";

export type TechnicalItem = { label: string; value: string | number | null };
export type TechnicalLeaf = { path: string[]; value: string | number | null };

type Change = AgentPlan["changes"][number];
type Target = AgentPlan["targets"][number];

const TECHNICAL_KEY = /(^|_)(uid|id|hash|sha256|fingerprint|version)$/;
// A 64-hex digest or a UUID, optionally behind a reference scheme such as
// `upload:` or `show:`.
const TECHNICAL_STRING =
  /^(?:[a-z][a-z0-9_-]*:)?(?:[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// Keys that only say which target a change applies to; the card header names
// the targets, so they are left out of the generic change body.
const TARGET_KEYS = new Set([
  "targets",
  "entity_uid",
  "artist_uid",
  "entity_type",
]);
// A nested record made only of these keys is a reference to a target.
const TARGET_REFERENCE_KEYS = new Set([
  "entity_type",
  "entity_uid",
  "artist_uid",
  "name",
  "label",
  "scope",
]);

/** `item_id`, `source_hash`, `planVersion`, `sha256`, … (snake or camel case). */
export function isTechnicalKey(key: string): boolean {
  const snake = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return TECHNICAL_KEY.test(snake);
}

/** A 64-hex digest or a UUID, bare or as a `scheme:` reference. */
export function isTechnicalString(value: unknown): value is string {
  return typeof value === "string" && TECHNICAL_STRING.test(value);
}

function leafValue(value: unknown): string | number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return undefined;
}

function collectLeaves(
  value: unknown,
  path: string[],
  sink: TechnicalLeaf[],
  keepEmpty: boolean,
) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectLeaves(entry, [...path, String(index + 1)], sink, false),
    );
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, entry]) =>
      collectLeaves(entry, [...path, humanizeKey(key)], sink, false),
    );
    return;
  }
  const leaf = leafValue(value);
  if (leaf === undefined || (leaf === null && !keepEmpty)) return;
  sink.push({ path, value: leaf });
}

function redact(
  value: unknown,
  path: string[],
  sink: TechnicalLeaf[],
): unknown {
  if (isTechnicalString(value)) {
    sink.push({ path, value });
    return TECHNICAL_PLACEHOLDER;
  }
  if (Array.isArray(value))
    return value.map((entry, index) =>
      redact(entry, [...path, String(index + 1)], sink),
    );
  if (!isRecord(value)) return value;
  const entries = Object.entries(value);
  const kept: [string, unknown][] = [];
  for (const [key, entry] of entries) {
    const entryPath = [...path, humanizeKey(key)];
    if (isTechnicalKey(key)) collectLeaves(entry, entryPath, sink, true);
    else kept.push([key, redact(entry, entryPath, sink)]);
  }
  if (entries.length > 0 && kept.length === 0) return TECHNICAL_PLACEHOLDER;
  return Object.fromEntries(kept);
}

/**
 * Splits a payload into what the review shows and the identifiers (keys such
 * as `item_id` or `source_hash`, digests and UUIDs) that belong in Technical
 * details. Never drops data: every hidden value is returned as a leaf.
 */
export function redactTechnical(
  value: unknown,
  path: string[] = [],
): { visible: unknown; hidden: TechnicalLeaf[] } {
  const hidden: TechnicalLeaf[] = [];
  const visible = redact(value, path, hidden);
  return { visible, hidden };
}

/** «Owner · Key › 1 › Key»-style label for a hidden value. */
export function technicalLabel(owner: string, path: string[]): string {
  const parts: string[] = [];
  for (const segment of path) {
    if (/^\d+$/.test(segment) && parts.length > 0)
      parts[parts.length - 1] = `${parts[parts.length - 1]} ${segment}`;
    else parts.push(segment);
  }
  return parts.length > 0 ? `${owner} · ${parts.join(" › ")}` : owner;
}

export function technicalItems(
  owner: string,
  leaves: TechnicalLeaf[],
): TechnicalItem[] {
  return leaves.map((leaf) => ({
    label: technicalLabel(owner, leaf.path),
    value: leaf.value,
  }));
}

const nonemptyText = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

/** Readable target name: its label, a non-technical name, or its kind. */
export function targetDisplayName(target: Record<string, unknown>): string {
  if (targetIdentity(target) === "library:global") return "Whole library";
  const label = nonemptyText(target.label);
  if (label) return label;
  const name = nonemptyText(target.name);
  if (name && !isTechnicalString(name)) return name;
  const kind = nonemptyText(target.entity_type);
  return kind ? humanizeKey(kind) : "Unknown target";
}

function resolvedTarget(
  reference: Record<string, unknown>,
  targets: Target[],
): Record<string, unknown> {
  const identity = targetIdentity(reference);
  return (
    (identity &&
      targets.find((target) => targetIdentity(target) === identity)) ||
    reference
  );
}

/** Every target a change applies to, by name, resolved through the plan. */
export function changeTargetLabels(
  change: Change,
  targets: Target[],
): string[] {
  if (targetIdentity(change))
    return [targetDisplayName(resolvedTarget(change, targets))];
  const nested = Array.isArray(change.targets)
    ? change.targets.filter(isRecord)
    : [];
  if (nested.length > 0)
    return nested.map((target) =>
      targetDisplayName(resolvedTarget(target, targets)),
    );
  return [change.scope === "global" ? "Whole library" : "Unknown target"];
}

// Replaces nested target references (for example `deleted_targets`) by the
// target's name when the plan declares that target.
function nameTargetReferences(value: unknown, targets: Target[]): unknown {
  if (Array.isArray(value))
    return value.map((entry) => nameTargetReferences(entry, targets));
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);
  const identity = targetIdentity(value);
  if (
    identity &&
    keys.length > 0 &&
    keys.every((key) => TARGET_REFERENCE_KEYS.has(key))
  ) {
    const target = targets.find((entry) => targetIdentity(entry) === identity);
    if (target) return targetDisplayName(target);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      nameTargetReferences(entry, targets),
    ]),
  );
}

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

export type ChangeBody =
  | { kind: "photo"; current: string; proposed: string }
  | { kind: "diff"; rows: FieldDiffRow[] }
  | { kind: "scalar"; current: unknown; proposed: unknown; cleared: boolean }
  | { kind: "details"; details: Record<string, unknown> | null };

export type ChangeView = {
  targets: string[];
  subject: string;
  body: ChangeBody;
  technical: TechnicalItem[];
};

function changeSubject(change: Change): string {
  const subject = change.field ?? change.action ?? change.pipeline;
  return humanizeKey(typeof subject === "string" ? subject : "operation");
}

/** What a change card shows, and the identifiers it moves out of view. */
export function changeView(
  change: Change,
  index: number,
  plan: Pick<AgentPlan, "operation" | "targets">,
): ChangeView {
  const targets = changeTargetLabels(change, plan.targets);
  const [onlyTarget] = targets;
  const owner =
    targets.length === 1 && onlyTarget && onlyTarget !== "Unknown target"
      ? onlyTarget
      : `Change ${index + 1}`;
  const subject = changeSubject(change);

  if (plan.operation === "repair_photo_flag")
    return {
      targets,
      subject,
      technical: [],
      body: {
        kind: "photo",
        current: change.before ? "Photo present" : "No photo",
        proposed: change.after ? "Photo present" : "No photo",
      },
    };

  if (hasOwn(change, "before") || hasOwn(change, "after")) {
    const before = redactTechnical(change.before, ["Current"]);
    const after = redactTechnical(change.after, ["Proposed"]);
    const technical = technicalItems(owner, [
      ...before.hidden,
      ...after.hidden,
    ]);
    const rows = fieldDiff(before.visible, after.visible);
    if (rows)
      return { targets, subject, technical, body: { kind: "diff", rows } };
    return {
      targets,
      subject,
      technical,
      body: {
        kind: "scalar",
        current: before.visible,
        proposed: after.visible,
        cleared:
          hasOwn(change, "after") &&
          change.after === null &&
          change.before !== null &&
          change.before !== undefined,
      },
    };
  }

  const rest = Object.fromEntries(
    Object.entries(change).filter(([key]) => !TARGET_KEYS.has(key)),
  );
  const { visible, hidden } = redactTechnical(
    nameTargetReferences(rest, plan.targets),
  );
  const details =
    isRecord(visible) && Object.keys(visible).length > 0 ? visible : null;
  return {
    targets,
    subject,
    technical: technicalItems(owner, hidden),
    body: { kind: "details", details },
  };
}

function excludedTracksText(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (value.length === 0) return "No excluded tracks";
  return `${value.length} excluded track${value.length === 1 ? "" : "s"}`;
}

/** Editorial content as shown (exclusions as counts, identifiers removed). */
export function editorialView(plan: AgentPlan): {
  visible: unknown;
  technical: TechnicalItem[];
} {
  const { visible, hidden } = redactTechnical({
    metadata: plan.metadata,
    smart_rules: plan.smart_rules,
    new_exclusions: excludedTracksText(plan.new_exclusions),
    existing_exclusions: excludedTracksText(plan.existing_exclusions),
    copied_exclusions: excludedTracksText(plan.copied_exclusions),
    source_revision: plan.source_revision,
    generation_epoch: plan.generation_epoch,
    provenance: plan.provenance,
  });
  return { visible, technical: technicalItems("Editorial content", hidden) };
}

/** Track identities of the selection and of every exclusion list. */
export function editorialTrackIdentities(plan: AgentPlan): TechnicalItem[] {
  const items: TechnicalItem[] = [];
  const selection: unknown[] = Array.isArray(plan.selection)
    ? plan.selection
    : [];
  selection.forEach((track, index) => {
    if (!isRecord(track)) return;
    const name = `${index + 1}. ${nonemptyText(track.title) ?? "Untitled"}`;
    const trackUid = nonemptyText(track.track_uid);
    const globalTrackUid = nonemptyText(track.global_track_uid);
    if (trackUid) items.push({ label: `${name} · Track ID`, value: trackUid });
    if (globalTrackUid)
      items.push({ label: `${name} · Global track ID`, value: globalTrackUid });
    if (typeof track.row_id === "number")
      items.push({ label: `${name} · Row ID`, value: track.row_id });
  });
  const newExclusions: unknown[] = Array.isArray(plan.new_exclusions)
    ? plan.new_exclusions
    : [];
  newExclusions.forEach((trackUid, index) => {
    const value = leafValue(trackUid);
    if (value !== undefined && value !== null)
      items.push({ label: `New exclusion ${index + 1} · Track ID`, value });
  });
  (
    [
      ["Existing exclusion", plan.existing_exclusions],
      ["Copied exclusion", plan.copied_exclusions],
    ] as const
  ).forEach(([kind, exclusions]) => {
    const entries: unknown[] = Array.isArray(exclusions) ? exclusions : [];
    entries.forEach((excluded, index) => {
      if (!isRecord(excluded)) return;
      const trackUid = nonemptyText(excluded.track_uid);
      const globalTrackUid = nonemptyText(excluded.global_track_uid);
      if (trackUid)
        items.push({
          label: `${kind} ${index + 1} · Track ID`,
          value: trackUid,
        });
      if (globalTrackUid)
        items.push({
          label: `${kind} ${index + 1} · Global track ID`,
          value: globalTrackUid,
        });
    });
  });
  return items;
}
