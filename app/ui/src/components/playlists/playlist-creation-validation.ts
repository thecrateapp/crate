import {
  createPlaylistEditorDraft,
  serializePlaylistEditorDraft,
  type PlaylistRuleDraft,
} from "./use-playlist-editor-draft";

export interface CreationRuleDraft {
  field: string;
  op: string;
  value: string;
  rangeMin: string;
  rangeMax: string;
}

export interface CreationErrors {
  limit?: string;
  featuredRank?: string;
  rules?: string;
  byRule: Record<number, string>;
}

export function validateFeaturedRank(featuredRank: string) {
  // The creation panels validate their name before calling this field adapter.
  const result = serializePlaylistEditorDraft(
    { ...createPlaylistEditorDraft(), name: "Playlist", featuredRank },
    { isSmart: false },
  );
  return {
    value: result.valid ? (result.payload.featured_rank ?? null) : null,
    error: result.valid ? undefined : result.errors.featuredRank,
  };
}

/** Adapt the creation composer to the editor's existing textual rule contract. */
export function validatePlaylistCreation({
  rules,
  limit,
  featuredRank,
}: {
  rules: CreationRuleDraft[];
  limit: string;
  featuredRank: string;
}) {
  const rank = validateFeaturedRank(featuredRank);
  const errors: CreationErrors = { byRule: {}, featuredRank: rank.error };
  const activeIndices: number[] = [];
  const activeRules: PlaylistRuleDraft[] = [];
  rules.forEach((rule, index) => {
    const values =
      rule.op === "between"
        ? [rule.rangeMin.trim(), rule.rangeMax.trim()]
        : [rule.value.trim()];
    if (values.every((value) => value === "")) return;
    activeIndices.push(index);
    activeRules.push({
      field: rule.field,
      op: rule.op,
      value:
        rule.op === "between"
          ? values.map((value, part) => value || (part === 0 ? "0000" : "9999"))
          : values[0]!,
    });
  });
  const result = serializePlaylistEditorDraft(
    { ...createPlaylistEditorDraft(), rules: activeRules, limit },
    { isSmart: true, scope: "rules" },
  );
  if (!result.valid) {
    errors.limit = result.errors.limit;
    errors.rules = result.errors.rules;
    for (const [key, message] of Object.entries(result.errors)) {
      const match = /^rules\.(\d+)\./.exec(key);
      const index = match ? activeIndices[Number(match[1])] : undefined;
      if (index !== undefined && message) errors.byRule[index] ??= message;
    }
  }
  if (rules.length > 12) errors.rules = "Use no more than 12 rules.";
  else if (activeRules.length === 0)
    errors.rules = "Add at least one smart rule.";
  return {
    valid: result.valid && !errors.featuredRank && !errors.rules,
    rules: result.valid ? (result.smartRules?.rules ?? []) : [],
    limit: result.valid ? result.smartRules!.limit : Number(limit),
    featuredRank: rank.value,
    errors,
  };
}
