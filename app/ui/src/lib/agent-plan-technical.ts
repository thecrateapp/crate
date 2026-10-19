import { humanizeKey } from "./humanize";
import type { AgentPlan } from "./agent-integrations";
import {
  fieldDiff,
  impactChips,
  impactDetails,
  type FieldDiffRow,
} from "./agent-plan-presentation";
import { isRecord, targetIdentity } from "./agent-plan-review";

/** Shown where a value was moved into Technical details. */
export const TECHNICAL_PLACEHOLDER = "Listed in technical details";

export type TechnicalItem = { label: string; value: string | number | null };
export type TechnicalLeaf = { path: string[]; value: string | number | null };

type Change = AgentPlan["changes"][number];
type Target = AgentPlan["targets"][number];

const TECHNICAL_KEY =
  /(^|_)(uid|id|hash|sha256|fingerprint|version|mbid)$|^musicbrainz_/;
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

/**
 * `item_id`, `source_hash`, `planVersion`, `sha256`, `mbid`,
 * `musicbrainz_trackid`, … (snake or camel case).
 */
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

/**
 * Names the plan's targets so that two different targets never share a name:
 * unlabelled targets of one kind become «Track 1», «Track 2», … Any other
 * reference falls back to its own display name.
 */
export function planTargetNamer(
  targets: Target[],
): (reference: Record<string, unknown>) => string {
  const identitiesByName = new Map<string, string[]>();
  for (const target of targets) {
    const identity = targetIdentity(target);
    if (!identity) continue;
    const name = targetDisplayName(target);
    const identities = identitiesByName.get(name) ?? [];
    if (!identities.includes(identity)) identities.push(identity);
    identitiesByName.set(name, identities);
  }
  const names = new Map<string, string>();
  identitiesByName.forEach((identities, name) =>
    identities.forEach((identity, index) =>
      names.set(
        identity,
        identities.length > 1 ? `${name} ${index + 1}` : name,
      ),
    ),
  );
  return (reference) => {
    const identity = targetIdentity(reference);
    return (identity && names.get(identity)) || targetDisplayName(reference);
  };
}

function targetLabelsWith(
  change: Change,
  nameOf: (reference: Record<string, unknown>) => string,
): string[] {
  if (targetIdentity(change)) return [nameOf(change)];
  const nested = Array.isArray(change.targets)
    ? change.targets.filter(isRecord)
    : [];
  if (nested.length > 0) return nested.map(nameOf);
  return [change.scope === "global" ? "Whole library" : "Unknown target"];
}

/** Every target a change applies to, by name, resolved through the plan. */
export function changeTargetLabels(
  change: Change,
  targets: Target[],
): string[] {
  return targetLabelsWith(change, planTargetNamer(targets));
}

// Replaces nested target references (for example `deleted_targets`) by the
// target's name when the plan declares that target.
function nameTargetReferences(
  value: unknown,
  targets: Target[],
  nameOf: (reference: Record<string, unknown>) => string,
): unknown {
  if (Array.isArray(value))
    return value.map((entry) => nameTargetReferences(entry, targets, nameOf));
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);
  const identity = targetIdentity(value);
  if (
    identity &&
    keys.length > 0 &&
    keys.every((key) => TARGET_REFERENCE_KEYS.has(key)) &&
    targets.some((entry) => targetIdentity(entry) === identity)
  )
    return nameOf(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      nameTargetReferences(entry, targets, nameOf),
    ]),
  );
}

const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

export type DiffRowView = {
  key: string;
  status: FieldDiffRow["status"];
  /** Value shown in the Current column. */
  before: unknown;
  /** Value shown in the Proposed column. */
  after: unknown;
  /** Some of this row's values are listed in Technical details. */
  seeTechnical: boolean;
};

export type ChangeBody =
  | { kind: "photo"; current: string; proposed: string }
  | { kind: "diff"; rows: DiffRowView[] }
  | {
      kind: "scalar";
      current: unknown;
      proposed: unknown;
      cleared: boolean;
      seeTechnical: boolean;
    }
  | { kind: "details"; details: Record<string, unknown> | null };

export type ChangeView = {
  /** 1-based position of the change in the plan. */
  number: number;
  /** Prefix of this change's Technical details labels. */
  owner: string;
  /** The card shows «Change n», which its Technical details labels use. */
  numbered: boolean;
  targets: string[];
  subject: string;
  /** A readable hint that tells similar cards apart (path or title). */
  discriminator: string | null;
  body: ChangeBody;
  /** The change's other keys (providers, policies, paths, …). */
  details: Record<string, unknown> | null;
  technical: TechnicalItem[];
};

function subjectKey(change: Change): string | null {
  for (const key of ["field", "action", "pipeline"])
    if (typeof change[key] === "string") return key;
  return null;
}

function changeSubject(change: Change): string {
  const key = subjectKey(change);
  return humanizeKey(key ? String(change[key]) : "operation");
}

function readableText(value: unknown): string | null {
  const text = nonemptyText(value);
  return text && !isTechnicalString(text) ? text : null;
}

function changeDiscriminator(change: Change): {
  text: string | null;
  key: string | null;
} {
  const relativePath = readableText(change.relative_path);
  if (relativePath) return { text: relativePath, key: "relative_path" };
  const before = isRecord(change.before) ? change.before : {};
  const after = isRecord(change.after) ? change.after : {};
  return {
    text:
      readableText(before.title) ??
      readableText(before.name) ??
      readableText(after.title),
    key: null,
  };
}

function hiddenLeaves(value: unknown, path: string[], whole: boolean) {
  if (!whole) return redactTechnical(value, path);
  const hidden: TechnicalLeaf[] = [];
  // An absent side (a new record) has nothing to list; an explicit null does.
  if (value !== undefined) collectLeaves(value, path, hidden, true);
  return { visible: TECHNICAL_PLACEHOLDER as unknown, hidden };
}

/**
 * Field rows are classified on the raw values, so a changed identifier is
 * never shown as unchanged. A row that changes or clears an identifier shows
 * both raw values (the reviewer must see what changes) and also lists them in
 * Technical details. An identifier added to a key the record did not have (a
 * brand-new record) is listed in Technical details alone — the record itself
 * is the change. An identifier added to a key the record already had, even
 * set to null, stays on the card as an added row pointing to Technical
 * details: the record's existing value changed and must stay visible.
 * Unchanged identifier keys are listed in Technical details alone.
 */
function diffRows(rows: FieldDiffRow[], sink: TechnicalLeaf[]): DiffRowView[] {
  const views: DiffRowView[] = [];
  for (const row of rows) {
    const label = humanizeKey(row.key);
    const technicalKey = isTechnicalKey(row.key);
    const before = hiddenLeaves(row.before, ["Current", label], technicalKey);
    const after = hiddenLeaves(row.after, ["Proposed", label], technicalKey);
    const hidden = [...before.hidden, ...after.hidden];
    if (hidden.length === 0 && !technicalKey) {
      views.push({ ...row, seeTechnical: false });
      continue;
    }
    sink.push(...hidden);
    if (row.status === "changed" || row.status === "cleared") {
      views.push({ ...row, seeTechnical: true });
      continue;
    }
    if (technicalKey) {
      // `row.before === undefined` means the key is absent from `before`: a
      // brand-new record, where there is nothing to compare against. A
      // present key (even null) means an existing record just gained this
      // identifier, so the row must stay visible.
      if (row.status !== "added" || row.before === undefined) continue;
      views.push({
        key: row.key,
        status: row.status,
        before: row.before,
        after: after.visible,
        seeTechnical: true,
      });
      continue;
    }
    views.push({
      key: row.key,
      status: row.status,
      before: before.visible,
      after: after.visible,
      seeTechnical: row.status === "added",
    });
  }
  return views;
}

type ChangeDraft = Omit<ChangeView, "owner" | "numbered" | "technical"> & {
  leaves: TechnicalLeaf[];
};

function changeDraft(
  change: Change,
  index: number,
  plan: Pick<AgentPlan, "operation" | "targets">,
  nameOf: (reference: Record<string, unknown>) => string,
): ChangeDraft {
  const targets = targetLabelsWith(change, nameOf);
  const subject = changeSubject(change);
  const leaves: TechnicalLeaf[] = [];
  const base = { number: index + 1, targets, subject, leaves };
  const hasBeforeAfter = hasOwn(change, "before") || hasOwn(change, "after");

  if (!hasBeforeAfter && plan.operation !== "repair_photo_flag") {
    const rest = Object.fromEntries(
      Object.entries(change).filter(([key]) => !TARGET_KEYS.has(key)),
    );
    const { visible, hidden } = redactTechnical(
      nameTargetReferences(rest, plan.targets, nameOf),
    );
    leaves.push(...hidden);
    return {
      ...base,
      discriminator: null,
      details: null,
      body: {
        kind: "details",
        details:
          isRecord(visible) && Object.keys(visible).length > 0 ? visible : null,
      },
    };
  }

  const discriminator = changeDiscriminator(change);
  // Keys the card already shows elsewhere: targets, the subject, the
  // before/after body and the discriminating path.
  const shown = new Set([...TARGET_KEYS, "before", "after"]);
  if (targetIdentity(change))
    TARGET_REFERENCE_KEYS.forEach((key) => shown.add(key));
  const subjectField = subjectKey(change);
  if (subjectField) shown.add(subjectField);
  if (discriminator.key) shown.add(discriminator.key);
  const siblings = redactTechnical(
    nameTargetReferences(
      Object.fromEntries(
        Object.entries(change).filter(([key]) => !shown.has(key)),
      ),
      plan.targets,
      nameOf,
    ),
  );
  const details =
    isRecord(siblings.visible) && Object.keys(siblings.visible).length > 0
      ? siblings.visible
      : null;
  const common = { ...base, discriminator: discriminator.text, details };

  if (plan.operation === "repair_photo_flag") {
    leaves.push(...siblings.hidden);
    return {
      ...common,
      body: {
        kind: "photo",
        current: change.before ? "Photo present" : "No photo",
        proposed: change.after ? "Photo present" : "No photo",
      },
    };
  }

  // A missing `before` means the record is new: every field is added.
  const rows = fieldDiff(
    change.before === undefined ? null : change.before,
    change.after,
  );
  if (rows) {
    const views = diffRows(rows, leaves);
    leaves.push(...siblings.hidden);
    return { ...common, body: { kind: "diff", rows: views } };
  }

  // A scalar change of an identifier (an MBID, a hash) is the subject of the
  // change: both values stay on the card and are also listed for copying.
  const subjectIsIdentifier =
    !!subjectField && isTechnicalKey(String(change[subjectField]));
  const before = hiddenLeaves(change.before, ["Current"], subjectIsIdentifier);
  const after = hiddenLeaves(change.after, ["Proposed"], subjectIsIdentifier);
  const identifiers = [...before.hidden, ...after.hidden];
  leaves.push(...identifiers, ...siblings.hidden);
  return {
    ...common,
    body: {
      kind: "scalar",
      current: change.before,
      proposed: change.after,
      cleared:
        hasOwn(change, "after") &&
        change.after === null &&
        change.before !== null &&
        change.before !== undefined,
      seeTechnical: identifiers.length > 0,
    },
  };
}

/**
 * What every change card shows, and the identifiers each one moves into
 * Technical details. Owners («Echo», «Track 2 · Genre», «Change 3») are unique
 * within the plan so a Technical details row can be tied to its card.
 */
export function planChangeViews(
  plan: Pick<AgentPlan, "operation" | "targets" | "changes">,
): ChangeView[] {
  const nameOf = planTargetNamer(plan.targets);
  const drafts = plan.changes.map((change, index) =>
    changeDraft(change, index, plan, nameOf),
  );
  const single = drafts.map(({ targets }) => {
    const [only] = targets;
    return targets.length === 1 && only && only !== "Unknown target"
      ? only
      : null;
  });
  const countOf = (values: (string | null)[], value: string | null) =>
    values.filter((entry) => entry === value).length;
  const firstPass = drafts.map((draft, index) => {
    const name = single[index] ?? null;
    if (name === null) return `Change ${draft.number}`;
    return countOf(single, name) > 1 ? `${name} · ${draft.subject}` : name;
  });
  return drafts.map(({ leaves, ...draft }, index) => {
    const candidate = firstPass[index] ?? `Change ${draft.number}`;
    const owner =
      countOf(firstPass, candidate) > 1
        ? `Change ${draft.number} · ${candidate}`
        : candidate;
    return {
      ...draft,
      owner,
      numbered: owner.startsWith(`Change ${draft.number}`),
      technical: technicalItems(owner, leaves),
    };
  });
}

/** Impact as chips, plus the lists and maps no chip can express. */
export function impactView(impact: Record<string, unknown> | undefined): {
  chips: string[];
  details: Record<string, unknown> | null;
  technical: TechnicalItem[];
} {
  const entries = Object.entries(impact ?? {});
  const identifier = ([key, value]: [string, unknown]) =>
    isTechnicalKey(key) || isTechnicalString(value);
  const readable = Object.fromEntries(
    entries.filter((entry) => !identifier(entry)),
  );
  const { visible, hidden } = redactTechnical({
    ...impactDetails(readable),
    ...Object.fromEntries(entries.filter(identifier)),
  });
  return {
    chips: impactChips(readable),
    details:
      isRecord(visible) && Object.keys(visible).length > 0 ? visible : null,
    technical: technicalItems("Impact", hidden),
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
