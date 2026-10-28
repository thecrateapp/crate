import { useCallback, useEffect, useMemo, useState } from "react";
import type { SetStateAction } from "react";

export interface PlaylistSmartRule {
  field: string;
  op: string;
  value: string | number | (string | number)[];
}

export interface PlaylistSmartRules {
  match?: "all" | "any";
  rules?: PlaylistSmartRule[];
  limit?: number;
  sort?: string;
  deduplicate_artist?: boolean;
  deduplicate_variants?: boolean;
  max_per_artist?: number;
  max_per_album?: number;
  expand_related_genres?: boolean;
  require_full_mix_profile?: boolean;
}

export interface PersistedPlaylistEditor {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  featured_rank: number | null;
  is_active: boolean;
  is_curated: boolean;
  auto_refresh_enabled: boolean;
  smart_rules: PlaylistSmartRules | null;
}

export interface PlaylistRuleDraft {
  field: string;
  op: string;
  value: string | string[];
}

/** Number inputs stay as text until submission, including empty/partial values. */
export interface PlaylistEditorDraft {
  name: string;
  description: string;
  category: string;
  featuredRank: string;
  isActive: boolean;
  isCurated: boolean;
  autoRefresh: boolean;
  rules: PlaylistRuleDraft[];
  match: "all" | "any";
  limit: string;
  sort: string;
  requireFullMixProfile: boolean;
}

const DRAFT_FIELDS = [
  "name",
  "description",
  "category",
  "featuredRank",
  "isActive",
  "isCurated",
  "autoRefresh",
  "rules",
  "match",
  "limit",
  "sort",
  "requireFullMixProfile",
] as const satisfies readonly (keyof PlaylistEditorDraft)[];

export function createPlaylistEditorDraft(
  playlist?: PersistedPlaylistEditor | null,
): PlaylistEditorDraft {
  return {
    name: playlist?.name ?? "",
    description: playlist?.description ?? "",
    category: playlist?.category ?? "",
    featuredRank:
      playlist?.featured_rank == null ? "" : String(playlist.featured_rank),
    isActive: playlist?.is_active ?? true,
    isCurated: playlist?.is_curated ?? false,
    autoRefresh: playlist?.auto_refresh_enabled ?? true,
    rules: (playlist?.smart_rules?.rules ?? []).map((rule) => ({
      ...rule,
      value: Array.isArray(rule.value)
        ? rule.value.map(String)
        : String(rule.value),
    })),
    match: playlist?.smart_rules?.match ?? "all",
    limit: String(playlist?.smart_rules?.limit ?? 50),
    sort: playlist?.smart_rules?.sort ?? "random",
    requireFullMixProfile:
      playlist?.smart_rules?.require_full_mix_profile ?? false,
  };
}

function equalField(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function copyDraft(draft: PlaylistEditorDraft): PlaylistEditorDraft {
  return {
    ...draft,
    rules: draft.rules.map((rule) => ({
      ...rule,
      value: Array.isArray(rule.value) ? [...rule.value] : rule.value,
    })),
  };
}

interface DraftState {
  identity: string;
  sourceFingerprint: string | null;
  baseline: PlaylistEditorDraft;
  draft: PlaylistEditorDraft;
}

function dirtyFieldsFor(
  state: DraftState,
): ReadonlySet<keyof PlaylistEditorDraft> {
  return new Set(
    DRAFT_FIELDS.filter(
      (key) => !equalField(state.draft[key], state.baseline[key]),
    ),
  );
}

/** Merge fresh snapshots into clean fields; local edits belong to this playlist identity. */
export function usePlaylistEditorDraft(
  id: number | string,
  persistedPlaylist?: PersistedPlaylistEditor | null,
) {
  const identity = String(id);
  const hasIncoming =
    persistedPlaylist != null && String(persistedPlaylist.id) === identity;
  const incoming = createPlaylistEditorDraft(
    hasIncoming ? persistedPlaylist : null,
  );
  const sourceFingerprint = hasIncoming ? JSON.stringify(incoming) : null;
  const [state, setState] = useState<DraftState>(() => ({
    identity,
    sourceFingerprint,
    baseline: incoming,
    draft: copyDraft(incoming),
  }));

  useEffect(() => {
    setState((current) => {
      if (
        current.identity === identity &&
        current.sourceFingerprint === sourceFingerprint
      )
        return current;
      if (current.identity !== identity) {
        return {
          identity,
          sourceFingerprint,
          baseline: incoming,
          draft: copyDraft(incoming),
        };
      }
      if (!hasIncoming) return current;
      const merged = Object.fromEntries(
        DRAFT_FIELDS.map((key) => [
          key,
          equalField(current.draft[key], current.baseline[key])
            ? incoming[key]
            : current.draft[key],
        ]),
      ) as unknown as PlaylistEditorDraft;
      return {
        identity,
        sourceFingerprint,
        baseline: incoming,
        draft: copyDraft(merged),
      };
    });
  }, [identity, sourceFingerprint]);

  const setField = useCallback(
    <K extends keyof PlaylistEditorDraft>(
      key: K,
      update: SetStateAction<PlaylistEditorDraft[K]>,
    ) => {
      setState((current) => {
        if (current.identity !== identity) return current;
        const value =
          typeof update === "function"
            ? (
                update as (
                  previous: PlaylistEditorDraft[K],
                ) => PlaylistEditorDraft[K]
              )(current.draft[key])
            : update;
        return { ...current, draft: { ...current.draft, [key]: value } };
      });
    },
    [identity],
  );

  /** Call with the fields actually sent, captured before awaiting the save request. */
  const acceptSaved = useCallback(
    (sent: Partial<PlaylistEditorDraft>) => {
      setState((current) => {
        // A response from the previous route cannot acknowledge this playlist's edits.
        if (current.identity !== identity) return current;
        return {
          ...current,
          baseline: copyDraft({ ...current.baseline, ...sent }),
        };
      });
    },
    [identity],
  );

  const reset = useCallback(() => {
    setState((current) =>
      current.identity === identity
        ? { ...current, draft: copyDraft(current.baseline) }
        : current,
    );
  }, [identity]);
  const dirtyFields = useMemo(() => dirtyFieldsFor(state), [state]);

  return {
    draft: state.draft,
    setField,
    dirtyFields,
    isDirty: dirtyFields.size > 0,
    reset,
    acceptSaved,
  };
}

export type PlaylistDraftErrors = Partial<
  Record<keyof PlaylistEditorDraft, string>
> &
  Record<string, string | undefined>;

export interface SerializedPlaylistSmartRules extends PlaylistSmartRules {
  match: "all" | "any";
  rules: PlaylistSmartRule[];
  limit: number;
  sort: string;
}

export interface PlaylistEditorPayload {
  name?: string;
  description?: string | null;
  category?: string | null;
  featured_rank?: number | null;
  is_active?: boolean;
  is_curated?: boolean;
  smart_rules?: SerializedPlaylistSmartRules;
  auto_refresh_enabled?: boolean;
}

type SerializedPlaylistDraft =
  | {
      valid: true;
      payload: PlaylistEditorPayload;
      smartRules: SerializedPlaylistSmartRules | null;
    }
  | { valid: false; errors: PlaylistDraftErrors };

const TEXT_FIELDS = new Set([
  "genre",
  "artist",
  "album",
  "title",
  "format",
  "audio_key",
]);
const NUMBER_FIELDS = new Set([
  "year",
  "bpm",
  "energy",
  "danceability",
  "valence",
  "acousticness",
  "instrumentalness",
  "loudness",
  "dynamic_range",
  "rating",
  "bit_depth",
  "sample_rate",
  "duration",
  "popularity",
]);
const TEXT_OPS = new Set(["eq", "neq", "contains", "not_contains", "in"]);
const NUMBER_OPS = new Set(["eq", "neq", "gte", "lte", "between", "in"]);
const SORTS = new Set([
  "random",
  "least_played",
  "popularity",
  "energy",
  "bpm",
  "title",
]);
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function finiteNumber(value: string): number | null {
  const trimmed = value.trim();
  const parsed = Number(trimmed);
  return DECIMAL.test(trimmed) && Number.isFinite(parsed) ? parsed : null;
}

/** Mirrors the closed API rule contract without coercing drafts while the user types. */
export function serializePlaylistEditorDraft(
  draft: PlaylistEditorDraft,
  options: {
    isSmart: boolean;
    persistedSmartRules?: PlaylistSmartRules | null;
    scope?: "all" | "rules";
  },
): SerializedPlaylistDraft {
  const errors: PlaylistDraftErrors = {};
  const includeEditorial = options.scope !== "rules";
  if (includeEditorial && !draft.name.trim())
    errors.name = "Enter a playlist name.";
  const featuredRank =
    draft.featuredRank.trim() === "" ? null : finiteNumber(draft.featuredRank);
  if (
    includeEditorial &&
    draft.featuredRank.trim() !== "" &&
    (featuredRank === null || !Number.isInteger(featuredRank))
  ) {
    errors.featuredRank = "Enter a whole number or leave this blank.";
  }

  let smartRules: SerializedPlaylistSmartRules | null = null;
  if (options.isSmart) {
    const limit = finiteNumber(draft.limit);
    if (
      limit === null ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 500
    ) {
      errors.limit = "Enter a whole number from 1 to 500.";
    }
    if (draft.match !== "all" && draft.match !== "any")
      errors.match = "Choose all or any rules.";
    if (!SORTS.has(draft.sort)) errors.sort = "Choose a supported sort order.";
    if (draft.rules.length > 12) errors.rules = "Use no more than 12 rules.";
    const rules = draft.rules.map((rule, index): PlaylistSmartRule => {
      const key = `rules.${index}`;
      const text = TEXT_FIELDS.has(rule.field);
      if (!text && !NUMBER_FIELDS.has(rule.field))
        errors[`${key}.field`] = "Choose a supported field.";
      if (!(text ? TEXT_OPS : NUMBER_OPS).has(rule.op))
        errors[`${key}.op`] = "Choose a supported operator.";
      const multiple = rule.op === "between" || rule.op === "in";
      const values = Array.isArray(rule.value) ? rule.value : [rule.value];
      if (
        multiple
          ? !Array.isArray(rule.value) ||
            values.length < 1 ||
            values.length > 16 ||
            (rule.op === "between" && values.length !== 2)
          : Array.isArray(rule.value)
      ) {
        errors[`${key}.value`] =
          rule.op === "between"
            ? "Enter a minimum and maximum."
            : "Enter the required rule value.";
      }
      const normalized = values.map((value, valueIndex): string | number => {
        const valueKey = multiple
          ? `${key}.value.${valueIndex}`
          : `${key}.value`;
        if (text) {
          if (!value.trim() || value.length > 200)
            errors[valueKey] = "Enter text of 1 to 200 characters.";
          return value;
        }
        if (rule.field === "year") {
          if (!/^\d{4}$/.test(value))
            errors[valueKey] = "Enter a four-digit year.";
          return value;
        }
        const number = finiteNumber(value);
        if (number === null) errors[valueKey] = "Enter a finite number.";
        return number ?? 0;
      });
      if (
        rule.op === "between" &&
        normalized.length === 2 &&
        Number(normalized[0]) > Number(normalized[1])
      ) {
        errors[`${key}.value`] = "The minimum must not exceed the maximum.";
      }
      return {
        field: rule.field,
        op: rule.op,
        value: multiple ? normalized : (normalized[0] ?? ""),
      };
    });
    const {
      require_full_mix_profile: persistedRequiresFullMixProfile,
      ...persistedRules
    } = options.persistedSmartRules ?? {};
    smartRules = {
      ...persistedRules,
      match: draft.match,
      rules,
      limit: limit ?? 50,
      sort: draft.sort,
      ...(draft.requireFullMixProfile ||
      persistedRequiresFullMixProfile !== undefined
        ? { require_full_mix_profile: draft.requireFullMixProfile }
        : {}),
    };
  }
  if (Object.keys(errors).length) return { valid: false, errors };
  return {
    valid: true,
    smartRules,
    payload: {
      ...(includeEditorial
        ? {
            name: draft.name,
            description: draft.description || null,
            category: draft.category || null,
            featured_rank: featuredRank,
            is_active: draft.isActive,
            is_curated: draft.isCurated,
          }
        : {}),
      ...(smartRules
        ? { smart_rules: smartRules, auto_refresh_enabled: draft.autoRefresh }
        : {}),
    },
  };
}
