import {
  apiErrorText,
  fieldDiff,
  type FieldDiffRow,
} from "@/lib/agent-plan-presentation";
import { reasonText } from "@/lib/ai-models";
import { humanizeKey } from "@/lib/humanize";
import type { StatusTone } from "@/components/admin/StatusBadge";
import { formatShowDateParts } from "@crate/ui/domain/shows/show-types";
import type {
  ConsolidationShow,
  ExtractionMethod,
  ModelMethod,
  ShowAvailability,
  ShowConsolidationPlan,
  ShowDraftRow,
  ShowImportChange,
  ShowOutcome,
} from "./show-import-types";

/** The methods that send the source to an AI model. */
export const MODEL_METHODS: ReadonlySet<ExtractionMethod> =
  new Set<ModelMethod>(["vision", "text_llm", "ocr_text_llm"]);

export function isModelMethod(method: ExtractionMethod): method is ModelMethod {
  return MODEL_METHODS.has(method);
}

/** Shown while an accepted review or save waits to be confirmed. */
export const UNCERTAIN_TEXT =
  "We lost contact before this was confirmed. Retrying continues the same request.";

export function modelDisplayName(model?: string | null): string {
  if (!model) return "AI model";
  const segments = model.split("/");
  const last = segments[segments.length - 1];
  return last || "AI model";
}

export interface SourceShape {
  images: number;
  hasText: boolean;
}

export interface MethodOption {
  method: ExtractionMethod;
  title: string;
  description: string;
  cost: string;
  billable: boolean;
  model: string | null;
  disabledReason: string | null;
  manageInAiModels: boolean;
}

export type ReadinessState =
  "loading" | "checking" | "ready" | "unavailable" | "unchecked" | "failed";

const METHOD_ORDER: ExtractionMethod[] = [
  "ocr",
  "ocr_text_llm",
  "vision",
  "parse",
  "text_llm",
];

const METHOD_META: Record<
  ExtractionMethod,
  { title: string; description: string; billable: boolean }
> = {
  ocr: {
    title: "Local OCR",
    description: "Reads the image on your server. Nothing leaves Crate.",
    billable: false,
  },
  ocr_text_llm: {
    title: "Local OCR + AI",
    description:
      "Reads the image locally, then sends only the text, never the image.",
    billable: true,
  },
  vision: {
    title: "AI image reading",
    description: "Sends the poster or screenshot to the AI model.",
    billable: true,
  },
  parse: {
    title: "Text rules",
    description: "Finds full dates in the text or the linked page. No AI.",
    billable: false,
  },
  text_llm: {
    title: "AI text reading",
    description: "Sends the pasted text or the text of the linked page.",
    billable: true,
  },
};

function isShown(method: ExtractionMethod, source: SourceShape): boolean {
  if (method === "ocr" || method === "ocr_text_llm" || method === "vision")
    return source.images >= 1;
  return source.images === 0 && source.hasText;
}

function disabledReason(
  method: ExtractionMethod,
  availability: ShowAvailability | null,
  readiness: ReadinessState,
): { reason: string | null; manageInAiModels: boolean } {
  if (isModelMethod(method)) {
    if (!availability)
      return { reason: "Checking AI models…", manageInAiModels: false };
    const action = availability.actions?.[method];
    if (!action?.configured)
      return {
        reason: reasonText(action?.reason ?? null),
        manageInAiModels: true,
      };
    if (!action.model || !action.configuration_fingerprint)
      return { reason: "Not available", manageInAiModels: true };
  }
  // Local OCR + AI reads the image with the same OCR engine first.
  if (
    (method === "ocr" || method === "ocr_text_llm") &&
    readiness === "unavailable" &&
    availability
  )
    return {
      reason: ocrReasonText(availability.ocr.reason ?? null),
      manageInAiModels: false,
    };
  return { reason: null, manageInAiModels: false };
}

export function methodOptions(
  availability: ShowAvailability | null,
  source: SourceShape,
  readiness: ReadinessState,
): MethodOption[] {
  return METHOD_ORDER.filter((method) => isShown(method, source)).map(
    (method) => {
      const meta = METHOD_META[method];
      const action = isModelMethod(method)
        ? availability?.actions?.[method]
        : undefined;
      const { reason, manageInAiModels } = disabledReason(
        method,
        availability,
        readiness,
      );
      const model = action?.model ?? null;
      const cost = !isModelMethod(method)
        ? method === "ocr"
          ? "Free · local OCR"
          : "Free · no AI"
        : reason === null
          ? `AI · ${modelDisplayName(model)}`
          : "AI";
      return {
        method,
        title: meta.title,
        description: meta.description,
        cost,
        billable: meta.billable,
        model,
        disabledReason: reason,
        manageInAiModels,
      };
    },
  );
}

export function pickMethod(
  current: ExtractionMethod | null,
  options: MethodOption[],
): ExtractionMethod | null {
  const byMethod = new Map(options.map((option) => [option.method, option]));
  const currentOption = current ? byMethod.get(current) : undefined;
  if (currentOption && currentOption.disabledReason === null) return current;
  for (const method of ["ocr", "parse"] as const) {
    const option = byMethod.get(method);
    if (option && option.disabledReason === null) return method;
  }
  return null;
}

/** What else goes with the image: the model reads every text source too. */
export interface SentAlong {
  pastedText: boolean;
  link: boolean;
}

function listed(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function aiSendNote(
  option: MethodOption,
  along: SentAlong = { pastedText: false, link: false },
): string | null {
  const model = modelDisplayName(option.model);
  const extras = [
    along.pastedText ? "your pasted text" : null,
    along.link ? "the linked page's text" : null,
  ].filter((part): part is string => part !== null);
  switch (option.method) {
    case "vision":
      return `Sends ${listed(["the image", ...extras])} to ${model} once. This counts toward your AI usage.`;
    case "ocr_text_llm":
      return `Sends ${listed(["the text read from the image", ...extras])} to ${model} once. The image stays on your server. This counts toward your AI usage.`;
    case "text_llm":
      return `Sends the text or the linked page's text to ${model} once. This counts toward your AI usage.`;
    default:
      return null;
  }
}

export function readinessKey(now: number): string {
  return `readiness-${Math.floor(now / 900_000)}`;
}

export function readinessState(
  availability: ShowAvailability | null,
  { checking, failed }: { checking: boolean; failed: boolean },
): ReadinessState {
  if (failed) return "failed";
  if (checking) return "checking";
  if (!availability) return "loading";
  if (!availability.checked_at) return "unchecked";
  return availability.ocr.available ? "ready" : "unavailable";
}

export function readinessView(state: ReadinessState): {
  label: string;
  tone: StatusTone;
} {
  switch (state) {
    case "loading":
    case "checking":
      return { label: "Checking the OCR worker…", tone: "info" };
    case "ready":
      return { label: "OCR ready", tone: "success" };
    case "unavailable":
      return { label: "OCR unavailable", tone: "warning" };
    case "unchecked":
      return { label: "OCR not checked", tone: "neutral" };
    case "failed":
      return { label: "Couldn't check the OCR worker", tone: "warning" };
  }
}

export function ocrReasonText(reason?: string | null): string {
  if (reason === "OCR_UNAVAILABLE")
    return "The worker has no OCR engine installed.";
  if (reason === "OCR_LANGUAGES_OR_VERSION_UNAVAILABLE")
    return "The worker's OCR engine is not version 5 or lacks English and Spanish.";
  return "OCR is not available on the worker.";
}

/** Where a saved show opens: Upcoming, with that show's detail expanded. */
export function showLinkPath(showId: number): string {
  return `/upcoming?show_id=${encodeURIComponent(String(showId))}`;
}

export function sourceLabel(
  ref?: string | null,
): { text: string; href?: string } | null {
  if (!ref) return null;
  if (/^https?:\/\//.test(ref)) {
    try {
      return { text: new URL(ref).host, href: ref };
    } catch {
      return { text: ref, href: ref };
    }
  }
  if (ref === "pasted-text") return { text: "Pasted text" };
  if (ref.startsWith("upload:")) return { text: "Uploaded image" };
  if (ref.startsWith("source-set:")) return { text: "Several sources" };
  return null;
}

export function draftRowView(row: ShowDraftRow): {
  title: string;
  detail: string;
} {
  const title = row.mode
    ? (METHOD_META[row.mode]?.title ?? "Import")
    : "Import";
  let detail: string;
  if (
    row.status === "pending" ||
    row.status === "running" ||
    row.status === "queued"
  ) {
    detail = "Still reading";
  } else if (row.status === "failed" || row.status === "cancelled") {
    detail = "Didn't finish";
  } else if (row.candidate_count === 0) {
    detail = "No shows found";
  } else if (typeof row.candidate_count === "number") {
    detail = `${countLabel(row.candidate_count, "show")} found`;
  } else {
    detail = "Still reading";
  }
  return { title, detail };
}

export function outcomeView(outcome: ShowOutcome): {
  label: string;
  tone: StatusTone;
} {
  switch (outcome.status) {
    case "created":
      return { label: "Saved", tone: "success" };
    case "already_exists":
      return { label: "Already in Crate", tone: "success" };
    case "linked_source":
      return { label: "Linked to a saved show", tone: "success" };
    case "conflict":
      return { label: "Not saved", tone: "warning" };
    case "invalid":
      return { label: "Needs changes", tone: "warning" };
    case "failed":
      return { label: "Not saved", tone: "danger" };
    default:
      return { label: humanizeKey(outcome.status), tone: "neutral" };
  }
}

export const SHOW_FIELD_LABELS: Record<string, string> = {
  artist_name: "Artist",
  date: "Date",
  local_time: "Time",
  venue: "Venue",
  city: "City",
  region: "Region",
  country: "Country",
  country_code: "Country code",
  address_line1: "Address",
  postal_code: "Postal code",
  timezone: "Timezone",
  doors_time: "Doors",
  url: "Event link",
  tickets_url: "Tickets link",
  image_url: "Image link",
  price_range: "Price",
  lineup: "Lineup",
  status: "Status",
  latitude: "Latitude",
  longitude: "Longitude",
};

export const SHOW_STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  onsale: "On sale",
  offsale: "Off sale",
  cancelled: "Cancelled",
  postponed: "Postponed",
  rescheduled: "Rescheduled",
};

export function missingText(fields: readonly string[]): string {
  const labels = fields.map((field) =>
    (SHOW_FIELD_LABELS[field] ?? humanizeKey(field)).toLowerCase(),
  );
  if (labels.length === 0) return "Missing required fields";
  if (labels.length === 1) return `Missing ${labels[0]}`;
  return `Missing ${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export function countLabel(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export interface PlanChangeView {
  title: string;
  subtitle: string;
  isUpdate: boolean;
  /** An update of a saved show that changes none of its fields. */
  unchangedUpdate: boolean;
  fields: {
    key: string;
    label: string;
    before?: unknown;
    value: unknown;
    status: "new" | FieldDiffRow["status"];
  }[];
  unchanged: number;
  evidence: string | null;
  source: { text: string; href?: string } | null;
  readBy: string | null;
  technical: { label: string; value: string | number }[];
}

function isMeaningful(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

const NEW_FIELD_EXCLUDE = new Set([
  "artist_name",
  "date",
  "local_time",
  "venue",
  "city",
]);

function newFields(after: Record<string, unknown>): PlanChangeView["fields"] {
  const fields: PlanChangeView["fields"] = [];
  for (const key of Object.keys(SHOW_FIELD_LABELS)) {
    if (NEW_FIELD_EXCLUDE.has(key)) continue;
    const value = after[key];
    if (!isMeaningful(value)) continue;
    if (key === "status") {
      if (value === "scheduled") continue;
      fields.push({
        key,
        label: SHOW_FIELD_LABELS[key]!,
        value:
          typeof value === "string"
            ? (SHOW_STATUS_LABELS[value] ?? humanizeKey(value))
            : value,
        status: "new",
      });
      continue;
    }
    fields.push({ key, label: SHOW_FIELD_LABELS[key]!, value, status: "new" });
  }
  return fields;
}

function pickFields(
  obj: Record<string, unknown> | undefined,
  keys: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!obj) return result;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) result[key] = obj[key];
  }
  return result;
}

function technicalDetails(
  after: Record<string, unknown>,
  rowLabel: string,
): { label: string; value: string | number }[] {
  const items: { label: string; value: string | number }[] = [];
  const push = (suffix: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    if (typeof value !== "string" && typeof value !== "number") return;
    items.push({ label: `${rowLabel} · ${suffix}`, value });
  };
  push("Item", after.item_id);
  push("Draft", after.source_draft_id);
  push("Library artist", after.artist_uid);
  push("Existing show", after.existing_show_id);
  push("Source reference", after.source_ref);
  const manifest = Array.isArray(after.source_manifest)
    ? after.source_manifest
    : [];
  manifest.forEach((record: unknown, index: number) => {
    if (!record || typeof record !== "object") return;
    const row = record as Record<string, unknown>;
    const value = [row.modality, row.source_ref, row.sha256 ?? row.text_sha256]
      .filter(
        (part): part is string => typeof part === "string" && part.length > 0,
      )
      .join(" · ");
    if (value)
      items.push({ label: `${rowLabel} · Source ${index + 1}`, value });
  });
  return items;
}

export function planChangeView(
  change: ShowImportChange,
  rowLabel: string,
): PlanChangeView {
  const after = change.after as unknown as Record<string, unknown>;
  const isUpdate = Object.keys(change.before).length > 0;
  const date = typeof after.date === "string" ? after.date : "";
  const localTime =
    typeof after.local_time === "string" ? after.local_time : "";
  const dateLabel = formatShowDateParts(date, "").dateLabel;
  const timeLabel = formatShowDateParts(date, localTime).timeLabel;
  const title = `${(after.artist_name as string) || "Unknown artist"} · ${dateLabel || "No date"}`;
  const locationParts = [
    after.venue,
    after.city,
    after.country_code ? String(after.country_code).toUpperCase() : null,
  ].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const subtitle = `${locationParts.join(", ")} · ${timeLabel || "Time unknown"}`;

  let fields: PlanChangeView["fields"];
  let unchanged: number;
  if (!isUpdate) {
    fields = newFields(after);
    unchanged = 0;
  } else {
    // A show matched by its details keeps its saved artist name; only an
    // explicitly chosen show takes the artist typed here.
    const keys = Object.keys(SHOW_FIELD_LABELS).filter(
      (key) => key !== "artist_name" || Boolean(after.existing_show_id),
    );
    const beforeSubset = pickFields(change.before, keys);
    const afterSubset = pickFields(after, keys);
    const diff = fieldDiff(beforeSubset, afterSubset) ?? [];
    const changedRows = diff.filter((row) => row.status !== "unchanged");
    fields = changedRows.map((row) => ({
      key: row.key,
      label: SHOW_FIELD_LABELS[row.key] ?? humanizeKey(row.key),
      before: row.before,
      value: row.after,
      status: row.status,
    }));
    unchanged = diff.length - changedRows.length;
  }

  return {
    title,
    subtitle,
    isUpdate,
    unchangedUpdate: isUpdate && fields.length === 0,
    fields,
    unchanged,
    evidence: (after.evidence as string | null | undefined) ?? null,
    source: sourceLabel(after.source_ref as string | null | undefined),
    readBy: after.extractor_model
      ? modelDisplayName(after.extractor_model as string)
      : null,
    technical: technicalDetails(after, rowLabel),
  };
}

export function issueText(
  issue: { reason?: string; missing?: string[] },
  rowLabel: string | null,
): string {
  if (issue.missing?.length) {
    const phrase = missingText(issue.missing);
    return `${rowLabel ?? "A show"} is ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}.`;
  }
  if (issue.reason) {
    return rowLabel ? `${rowLabel}: ${issue.reason}` : issue.reason;
  }
  return `${rowLabel ?? "This selection"} can't be saved as it is.`;
}

const SHOW_ERROR_TEXT: Record<string, string> = {
  CONFIGURATION_CHANGED:
    "The AI model changed. Check the method and try again.",
  LLM_UNAVAILABLE:
    "That AI model isn't available right now. Choose another method.",
  PLAN_STALE: "A show changed after your review. Review again before saving.",
  TARGET_BUSY: "Another change is saving these shows. Try again in a moment.",
};

/** The server's one-outstanding-job refusal (`agent_requests._accept`). */
const ACTIVE_JOB_DETAIL =
  "This integration already has an active maintenance job";
const ACTIVE_JOB_TEXT =
  "Another import or save of yours is still running. Try again in a moment.";

/** The word for the action that runs again once the plan is approved. */
export type ApprovalAction = "save" | "merge";

/**
 * What to do about a plan that needs approval. Only an editor who can review
 * plans is sent to Agent approvals; anyone else is told who has to.
 */
export function approvalNextStep(
  action: ApprovalAction,
  canApprove: boolean,
  { again = false }: { again?: boolean } = {},
): string {
  const verb = again ? `${action} again` : action;
  return canApprove
    ? `Approve it in Agent approvals, then ${verb}.`
    : `Someone who can approve changes must approve it in Agent approvals. Then come back and ${verb}.`;
}

export function showErrorText(
  error: unknown,
  fallback: string,
  context: { action?: ApprovalAction; canApprove?: boolean } = {},
): string {
  const code = (error as { code?: string } | null | undefined)?.code;
  if (code === "APPROVAL_REQUIRED") {
    const action = context.action ?? "save";
    const subject = action === "merge" ? "This merge" : "This change";
    return `${subject} needs approval first. ${approvalNextStep(
      action,
      context.canApprove ?? true,
      { again: true },
    )}`;
  }
  if (
    code === "LIMIT_EXCEEDED" &&
    apiErrorText(error, "") === ACTIVE_JOB_DETAIL
  )
    return ACTIVE_JOB_TEXT;
  if (code && SHOW_ERROR_TEXT[code]) return SHOW_ERROR_TEXT[code];
  return apiErrorText(error, fallback);
}

export interface MergeShowView {
  id: number;
  title: string;
  detail: string;
  people: string;
}

export function mergeShowView(show: ConsolidationShow): MergeShowView {
  const dateLabel = formatShowDateParts(show.date ?? "", "").dateLabel;
  const timeLabel = formatShowDateParts(
    show.date ?? "",
    show.local_time ?? "",
  ).timeLabel;
  return {
    id: show.id,
    title: `${show.artist_name || "Unknown artist"} · ${dateLabel || "No date"}`,
    detail: `${show.venue ?? ""}, ${show.city ?? ""} · ${timeLabel || "Time unknown"}`,
    people: `${show.attendance_count} going · ${countLabel(show.reminder_count, "reminder")}`,
  };
}

export function mergePlanView(plan: ShowConsolidationPlan): {
  keep: MergeShowView | null;
  merge: MergeShowView[];
} {
  const change = plan.changes.find((c) => c.item_id === "consolidation");
  if (!change) return { keep: null, merge: [] };
  const { before, after } = change;
  const shows = before.shows ?? [];
  const byId = new Map(shows.map((show) => [show.id, show]));
  const keepShow =
    after.canonical_show_id !== undefined
      ? byId.get(after.canonical_show_id)
      : undefined;
  const mergeShows = (after.duplicate_show_ids ?? [])
    .map((id) => byId.get(id))
    .filter((show): show is ConsolidationShow => Boolean(show));
  return {
    keep: keepShow ? mergeShowView(keepShow) : null,
    merge: mergeShows.map(mergeShowView),
  };
}
