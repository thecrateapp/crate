import {
  emptyShow,
  isShowSaved,
  type ShowCandidate,
  type ShowDraft,
  type ShowOutcome,
} from "./show-import-types";

export type RequiredShowField = "artist_name" | "date" | "venue" | "city";

export const REQUIRED_SHOW_FIELDS: readonly RequiredShowField[] = [
  "artist_name",
  "date",
  "venue",
  "city",
];

export const MAX_SELECTED_SHOWS = 50;
export const MAX_DRAFT_SHOWS = 200;

export interface ShowDraftState {
  candidates: ShowCandidate[];
  selected: string[];
}

export type SharedShowFields = {
  artist_name?: string;
  country_code?: string;
};

function fieldValue(
  candidate: ShowCandidate,
  field: RequiredShowField,
): string {
  const value = candidate[field];
  return typeof value === "string" ? value.trim() : "";
}

export function newDraft(): ShowDraftState {
  const candidate = emptyShow();
  return { candidates: [candidate], selected: [candidate.item_id] };
}

export function isBlankCandidate(candidate: ShowCandidate): boolean {
  return REQUIRED_SHOW_FIELDS.every((field) => !fieldValue(candidate, field));
}

export function missingFields(candidate: ShowCandidate): RequiredShowField[] {
  return REQUIRED_SHOW_FIELDS.filter((field) => !fieldValue(candidate, field));
}

export function savedItemIds(outcomes: ShowOutcome[]): Set<string> {
  return new Set(
    outcomes.filter(isShowSaved).map((outcome) => outcome.item_id),
  );
}

export function addDate(draft: ShowDraftState): ShowDraftState {
  if (draft.candidates.length >= MAX_DRAFT_SHOWS) return draft;
  const last = draft.candidates[draft.candidates.length - 1];
  const row: ShowCandidate = {
    ...emptyShow(),
    artist_name: last?.artist_name ?? "",
    ...(last?.artist_uid ? { artist_uid: last.artist_uid } : {}),
  };
  return {
    candidates: [...draft.candidates, row],
    selected:
      draft.selected.length < MAX_SELECTED_SHOWS
        ? [...draft.selected, row.item_id]
        : draft.selected,
  };
}

export function removeDate(
  draft: ShowDraftState,
  itemId: string,
): ShowDraftState {
  if (draft.candidates.length <= 1) return draft;
  return {
    candidates: draft.candidates.filter((c) => c.item_id !== itemId),
    selected: draft.selected.filter((id) => id !== itemId),
  };
}

export function selectAllValid(
  draft: ShowDraftState,
  saved: Set<string>,
): string[] {
  return draft.candidates
    .filter(
      (candidate) =>
        !saved.has(candidate.item_id) && missingFields(candidate).length === 0,
    )
    .slice(0, MAX_SELECTED_SHOWS)
    .map((candidate) => candidate.item_id);
}

export function fillTargets(
  draft: ShowDraftState,
  saved: Set<string>,
): { ids: string[]; scope: "selected" | "unsaved" } {
  const unsavedIds = draft.candidates
    .filter((candidate) => !saved.has(candidate.item_id))
    .map((candidate) => candidate.item_id);
  // A selection made only of saved rows fills nothing, so it doesn't count.
  const selected = new Set(draft.selected);
  const selectedIds = unsavedIds.filter((id) => selected.has(id));
  if (selectedIds.length > 0) return { ids: selectedIds, scope: "selected" };
  return { ids: unsavedIds, scope: "unsaved" };
}

export function fillDates(
  draft: ShowDraftState,
  values: SharedShowFields,
  ids: string[],
): ShowDraftState {
  const targets = new Set(ids);
  const patch: Partial<ShowCandidate> = {};
  if (values.artist_name?.trim()) {
    patch.artist_name = values.artist_name.trim();
    patch.artist_uid = null;
  }
  if (values.country_code?.trim()) {
    patch.country_code = values.country_code.trim();
  }
  if (Object.keys(patch).length === 0) return draft;
  return {
    ...draft,
    candidates: draft.candidates.map((candidate) =>
      targets.has(candidate.item_id) ? { ...candidate, ...patch } : candidate,
    ),
  };
}

export function reviewSelection(
  draft: ShowDraftState,
  saved: Set<string>,
): ShowCandidate[] {
  const unsaved = draft.candidates.filter(
    (candidate) => !saved.has(candidate.item_id),
  );
  // A lone unsaved row counts as selected, whatever `selected` holds.
  if (unsaved.length === 1) return unsaved;
  const selected = new Set(draft.selected);
  return draft.candidates.filter(
    (candidate) =>
      selected.has(candidate.item_id) && !saved.has(candidate.item_id),
  );
}

// The fields that make two rows the same show to the editor.
const IDENTITY_FIELDS = [
  "artist_name",
  "date",
  "local_time",
  "venue",
  "city",
] as const;

function identityKey(candidate: ShowCandidate): string {
  return IDENTITY_FIELDS.map((field) => {
    const value = candidate[field];
    return typeof value === "string" ? value.trim().toLowerCase() : "";
  }).join("|");
}

// Every field an editor can fill in, besides the status they start with.
const CONTENT_FIELDS = [
  "artist_name",
  "date",
  "local_time",
  "venue",
  "city",
  "region",
  "country",
  "country_code",
  "address_line1",
  "postal_code",
  "timezone",
  "doors_time",
  "url",
  "tickets_url",
  "image_url",
  "price_range",
  "lineup",
  "latitude",
  "longitude",
] as const satisfies readonly (keyof ShowCandidate)[];

/** Whether discarding this row would lose anything typed or imported. */
export function hasShowContent(candidate: ShowCandidate): boolean {
  return CONTENT_FIELDS.some((field) => {
    const value = candidate[field];
    if (typeof value === "string") return value.trim() !== "";
    if (Array.isArray(value)) return value.length > 0;
    return typeof value === "number";
  });
}

/** Unsaved rows that hold something, so discarding them needs a yes. */
export function unsavedWithContent(
  draft: ShowDraftState,
  saved: Set<string>,
): ShowCandidate[] {
  return draft.candidates.filter(
    (candidate) => !saved.has(candidate.item_id) && hasShowContent(candidate),
  );
}

export function mergeImportedDraft(
  draft: ShowDraftState,
  imported: ShowDraft,
  saved: ReadonlySet<string> = new Set(),
): ShowDraftState {
  // An import that found nothing keeps the draft, including its blank row.
  if (imported.candidates.length === 0) return draft;
  const existingById = new Map(
    draft.candidates.map((candidate) => [candidate.item_id, candidate]),
  );
  // Running an import again finds the same shows again under new item IDs;
  // an unsaved row that is already here stays as it is, edits included.
  const publication = imported.publication ?? {};
  const unsavedKeys = new Set(
    draft.candidates
      .filter(
        (candidate) =>
          !isBlankCandidate(candidate) &&
          !saved.has(candidate.item_id) &&
          !isShowSaved(publication[candidate.item_id]),
      )
      .map(identityKey),
  );
  const rows = imported.candidates.flatMap((candidate) => {
    const row = { ...candidate, source_draft_id: imported.draft_id };
    const existing = existingById.get(row.item_id);
    if (!existing && unsavedKeys.has(identityKey(row))) return [];
    return existing && !isShowSaved(publication[row.item_id])
      ? [{ ...row, ...existing }]
      : [row];
  });
  if (rows.length === 0) return draft;
  const rowIds = new Set(rows.map((row) => row.item_id));
  const merged =
    isBlankCandidate(draft.candidates[0]!) && draft.candidates.length === 1
      ? rows
      : [
          ...draft.candidates.filter(
            (candidate) => !rowIds.has(candidate.item_id),
          ),
          ...rows,
        ];
  return { candidates: merged, selected: [] };
}
